import {formatISO} from "date-fns";
import ConfirmDatePlugin from "flatpickr/dist/plugins/confirmDate/confirmDate";
import $ from "jquery";
import _ from "lodash";

import pygments_data from "../generated/pygments_data.json";
import * as emoji from "../shared/js/emoji";
import * as typeahead from "../shared/js/typeahead";

import * as channel from "./channel";
import * as compose from "./compose";
import * as compose_pm_pill from "./compose_pm_pill";
import * as compose_state from "./compose_state";
import * as compose_ui from "./compose_ui";
import {$t} from "./i18n";
import * as message_store from "./message_store";
import * as muting from "./muting";
import {page_params} from "./page_params";
import * as people from "./people";
import * as rows from "./rows";
import * as settings_data from "./settings_data";
import * as stream_data from "./stream_data";
import * as stream_topic_history from "./stream_topic_history";
import * as stream_topic_history_util from "./stream_topic_history_util";
import * as timerender from "./timerender";
import * as typeahead_helper from "./typeahead_helper";
import * as user_groups from "./user_groups";
import * as user_pill from "./user_pill";

// **********************************
// AN IMPORTANT NOTE ABOUT TYPEAHEADS
// **********************************
// They do not do any HTML escaping, at all.
// And your input to them is rendered as though it were HTML by
// the default highlighter.
//
// So if you are not using trusted input, you MUST use the a
// highlighter that escapes (i.e. one that calls
// typeahead_helper.highlight_with_escaping).

// This is what we use for PM/compose typeaheads.
// We export it to allow tests to mock it.
export const max_num_items = 8;

export let emoji_collection = [];

export function update_emoji_data() {
    emoji_collection = [];
    for (const emoji_dict of emoji.emojis_by_name.values()) {
        if (emoji_dict.is_realm_emoji === true) {
            emoji_collection.push({
                emoji_name: emoji_dict.name,
                emoji_url: emoji_dict.url,
                is_realm_emoji: true,
            });
        } else {
            for (const alias of emoji_dict.aliases) {
                emoji_collection.push({
                    emoji_name: alias,
                    emoji_code: emoji_dict.emoji_code,
                });
            }
        }
    }
}

export function topics_seen_for(stream_name) {
    const stream_id = stream_data.get_stream_id(stream_name);
    if (!stream_id) {
        return [];
    }

    // Fetch topic history from the server, in case we will need it soon.
    stream_topic_history_util.get_server_history(stream_id, () => {});
    const topic_names = stream_topic_history.get_recent_topic_names(stream_id);
    return topic_names;
}

function get_language_matcher(query) {
    query = query.toLowerCase();
    return function (lang) {
        return lang.includes(query);
    };
}

export function query_matches_person(query, person) {
    if (!settings_data.show_email()) {
        return typeahead.query_matches_source_attrs(query, person, ["full_name"], " ");
    }
    let email_attr = "email";
    if (person.delivery_email) {
        email_attr = "delivery_email";
    }
    return typeahead.query_matches_source_attrs(query, person, ["full_name", email_attr], " ");
}

export function query_matches_name_description(query, user_group_or_stream) {
    return typeahead.query_matches_source_attrs(
        query,
        user_group_or_stream,
        ["name", "description"],
        " ",
    );
}

function get_stream_or_user_group_matcher(query) {
    // Case-insensitive.
    query = typeahead.clean_query_lowercase(query);

    return function (user_group_or_stream) {
        return query_matches_name_description(query, user_group_or_stream);
    };
}

function get_slash_matcher(query) {
    query = typeahead.clean_query_lowercase(query);

    return function (item) {
        return typeahead.query_matches_source_attrs(query, item, ["name"], " ");
    };
}

function get_topic_matcher(query) {
    query = typeahead.clean_query_lowercase(query);

    return function (topic) {
        const obj = {
            topic,
        };

        return typeahead.query_matches_source_attrs(query, obj, ["topic"], " ");
    };
}

export function should_enter_send(e) {
    const has_non_shift_modifier_key = e.ctrlKey || e.metaKey || e.altKey;
    const has_modifier_key = e.shiftKey || has_non_shift_modifier_key;
    let this_enter_sends;
    if (page_params.enter_sends) {
        // With the enter_sends setting, we should send
        // the message unless the user was holding a
        // modifier key.
        this_enter_sends = !has_modifier_key;
    } else {
        // If enter_sends is not enabled, just hitting
        // Snter should add a newline, but with a
        // non-Shift modifier key held down, we should
        // send.  With Shift, we shouldn't, because
        // Shift+Enter to get a newline is a common
        // keyboard habit for folks for dealing with other
        // chat products where Enter-always-sends.
        this_enter_sends = has_non_shift_modifier_key;
    }
    return this_enter_sends;
}

export function handle_enter(textarea, e) {
    // Used only if Enter doesn't send.

    // Since this Enter doesn't send, we just want to do
    // the browser's default behavior for the "Enter" key.
    // Letting the browser handle it works great if the
    // key actually pressed was Enter or Shift-Enter.

    // But the default browser behavior for Ctrl/Alt/Meta
    // + Enter is to do nothing, so we need to emulate
    // the browser behavior for "Enter" in those cases.
    //
    // We do this using caret and range from jquery-caret.
    const has_non_shift_modifier_key = e.ctrlKey || e.metaKey || e.altKey;
    if (has_non_shift_modifier_key) {
        // To properly emulate browser "Enter", if the
        // user had selected something in the textarea,
        // we need those characters to be cleared.
        const range = textarea.range();
        if (range.length > 0) {
            textarea.range(range.start, range.end).range("");
        }

        // Now add the newline, remembering to resize the
        // textarea if needed.
        textarea.caret("\n");
        compose_ui.autosize_textarea(textarea);
        e.preventDefault();
        return;
    }
    // Fall through to native browser behavior, otherwise.
}

let nextFocus = false;

function handle_keydown(e) {
    const key = e.key;

    if (key === "Enter" || (key === "Tab" && !e.shiftKey)) {
        // Enter key or Tab key
        let target_sel;

        if (e.target.id) {
            target_sel = `#${CSS.escape(e.target.id)}`;
        }

        const on_stream = target_sel === "#stream_message_recipient_stream";
        const on_topic = target_sel === "#stream_message_recipient_topic";
        const on_pm = target_sel === "#private_message_recipient";
        const on_compose = target_sel === "#compose-textarea";

        if (on_compose) {
            if (key === "Tab") {
                // This if branch is only here to make Tab+Enter work on Safari,
                // which does not make <button>s tab-accessible by default
                // (even if we were to set tabindex=0).
                if (!should_enter_send(e)) {
                    $("#compose-send-button").trigger("focus");
                    e.preventDefault();
                }
            } else {
                // Enter
                if (should_enter_send(e)) {
                    e.preventDefault();
                    if (!$("#compose-send-button").prop("disabled")) {
                        $("#compose-send-button").prop("disabled", true);
                        compose.finish();
                    }
                    return;
                }

                handle_enter($("#compose-textarea"), e);
            }
        } else if (on_stream || on_topic || on_pm) {
            // Prevent the form from submitting
            e.preventDefault();

            // We are doing the focusing on keyup to not abort the typeahead.
            if (on_stream) {
                nextFocus = $("#stream_message_recipient_topic");
            } else if (on_topic) {
                nextFocus = $("#compose-textarea");
            } else if (on_pm) {
                nextFocus = $("#compose-textarea");
            }
        }
    }
}

function handle_keyup(e) {
    if (
        // Enter key or Tab key
        (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) &&
        nextFocus
    ) {
        nextFocus.trigger("focus");
        nextFocus = false;
    }
}

export function split_at_cursor(query, input) {
    const cursor = input.caret();
    return [query.slice(0, cursor), query.slice(cursor)];
}

export function tokenize_compose_str(s) {
    // This basically finds a token like "@alic" or
    // "#Veron" as close to the end of the string as it
    // can find it.  It wants to find white space or
    // punctuation before the token, unless it's at the
    // beginning of the line.  It doesn't matter what comes
    // after the first character.
    let i = s.length;

    let min_i = s.length - 25;
    if (min_i < 0) {
        min_i = 0;
    }

    while (i > min_i) {
        i -= 1;
        switch (s[i]) {
            case "`":
            case "~":
                // Code block must start on a new line
                if (i === 2) {
                    return s;
                } else if (i > 2 && s[i - 3] === "\n") {
                    return s.slice(i - 2);
                }
                break;
            case "/":
                if (i === 0) {
                    return s;
                }
                break;
            case "#":
            case "@":
            case ":":
            case "_":
                if (i === 0) {
                    return s;
                } else if (/[\s()[\]{}]/.test(s[i - 1])) {
                    return s.slice(i);
                }
                break;
            case ">":
                // topic_jump
                //
                // If you hit `>` immediately after completing the typeahead for mentioning a stream,
                // this will reposition the user from.  If | is the cursor, implements:
                //
                // `#**stream name** >|` => `#**stream name>|`.
                if (
                    s.slice(Math.max(0, i - 2), i) === "**" ||
                    s.slice(Math.max(0, i - 3), i) === "** "
                ) {
                    // return any string as long as its not ''.
                    return ">topic_jump";
                }
                // maybe topic_list; let's let the stream_topic_regex decide later.
                return ">topic_list";
        }
    }

    const timestamp_index = s.indexOf("<time");
    if (timestamp_index >= 0) {
        return s.slice(timestamp_index);
    }

    return "";
}

export function broadcast_mentions() {
    return ["all", "everyone", "stream"].map((mention, idx) => ({
        special_item_text: $t(
            {defaultMessage: "{wildcard_mention_token} (Notify stream)"},
            {wildcard_mention_token: mention},
        ),

        email: mention,

        // Always sort above, under the assumption that names will
        // be longer and only contain "all" as a substring.
        pm_recipient_count: Number.POSITIVE_INFINITY,

        full_name: mention,
        is_broadcast: true,

        // used for sorting
        idx,
    }));
}

function filter_mention_name(current_token) {
    if (current_token.startsWith("**")) {
        current_token = current_token.slice(2);
    } else if (current_token.startsWith("*")) {
        current_token = current_token.slice(1);
    }
    if (current_token.length < 1 || current_token.lastIndexOf("*") !== -1) {
        return false;
    }

    // Don't autocomplete if there is a space following an '@'
    if (current_token[0] === " ") {
        return false;
    }
    return current_token;
}

function should_show_custom_query(query, items) {
    // returns true if the custom query doesn't match one of the
    // choices in the items list.
    if (!query) {
        return false;
    }
    const matched = items.some((elem) => elem.toLowerCase() === query.toLowerCase());
    return !matched;
}

export const slash_commands_chat = [
    {
        text: $t({defaultMessage: "/sk [-sms] [Message*] (Send message to email/sms)"}),
        name: "sk",
    },
];

export const slash_commands_workflow = [
    {
        text: $t({defaultMessage: "/finish_task (Confirm to finish task)"}),
        name: "finish_task",
    },
    {
        text: $t({defaultMessage: "/fix_editor (Fix editor to classic)"}),
        name: "fix_editor",
    },
    {
        text: $t({defaultMessage: "/get_task (Get task for work)"}),
        name: "get_task",
    },
    {
        text: $t({defaultMessage: "/summary (Summary this topic)"}),
        name: "summary",
    },
];

export const slash_commands_keyword = [
    {
        text: $t({defaultMessage: "/keyword_link [keyword*] [link*] (Set page link of keyword)"}),
        name: "keyword_link",
    },
    {
        text: $t({defaultMessage: "/keyword_negative [keyword*] (Set negative keyword)"}),
        name: "keyword_negative",
    },
    {
        text: $t({defaultMessage: "/keyword_seed [[type]] [keyword*] (Set keyword seed for SMART)"}),
        name: "keyword_seed",
    },
    {
        text: $t({defaultMessage: "/keyword_update (Update new keywords list for SMART)"}),
        name: "keyword_update",
    },
];

export const slash_commands_admin_keyword = [
    {
        text: $t({defaultMessage: "/keyword_link [keyword*] [link*] (Set page link of keyword)"}),
        name: "keyword_link",
    },
    {
        text: $t({defaultMessage: "/keyword_negative [keyword*] (Set negative keyword)"}),
        name: "keyword_negative",
    },
    {
        text: $t({defaultMessage: "/keyword_seed [[type]] [keyword*] (Set keyword seed for SMART)"}),
        name: "keyword_seed",
    },
    {
        text: $t({defaultMessage: "/keyword_submit -type* [type*] -seed* [seed keyword*] -keywords* [keywords_list*] (Submit new keywords to database)"}),
        name: "keyword_submit",
    },
    {
        text: $t({defaultMessage: "/keyword_update (Update new keywords list for SMART)"}),
        name: "keyword_update",
    },
    {
        text: $t({defaultMessage: "/test_command (Test command for admin)"}),
        name: "test_command",
    },
];

export const slash_commands_project = [
    {
        text: $t({defaultMessage: "/archive_project (Archive project and close)"}),
        name: "archive_project",
    },
    {
        text: $t({defaultMessage: "/sk_comment [comment*] (Comment to all tasks in project)"}),
        name: "sk_comment",
    },
    {
        text: $t({defaultMessage: "/task_note [id*] [delete] [//note*] (Note in task)"}),
        name: "task_note",
    },
];

export const slash_commands_admin_project = [
    {
        text: $t({defaultMessage: "/project_activate (Activate project)"}),
        name: "project_activate",
    },
    {
        text: $t({defaultMessage: "/archive_project (Archive project and close)"}),
        name: "archive_project",
    },
    {
        text: $t({defaultMessage: "/project_cancel [project_id] //Reason of cancellation (Cancel project)"}),
        name: "project_cancel",
    },
    {
        text: $t({defaultMessage: "/project_set [level/priority/speed] [value] (Project set level, priority, speed)"}),
        name: "project_set",
    },
    {
        text: $t({defaultMessage: "/sk [-sms] [Message*] (Send message to email/sms)"}),
        name: "sk",
    },
    {
        text: $t({defaultMessage: "/sk_comment [comment*] (Comment to all tasks in project)"}),
        name: "sk_comment",
    },
    {
        text: $t({defaultMessage: "/task_note [id*] [delete] [//note*] (Note in task)"}),
        name: "task_note",
    },
    {
        text: $t({defaultMessage: "/test_command (Test command for admin)"}),
        name: "test_command",
    },
];

export const slash_commands_admin_webpage = [
    {
        text: $t({defaultMessage: "/test_command (Test command for admin)"}),
        name: "test_command",
    },
    {
        text: $t({defaultMessage: "/webpage_activate (Activate webpage)"}),
        name: "webpage_activate",
    },
    {
        text: $t({defaultMessage: "/webpage_hosting [create/remove*] (Create/remove hosting of webpage)"}),
        name: "webpage_hosting",
    },
    {
        text: $t({defaultMessage: "/webpage_import [post/page/product*] [old_link*] (Import from other webpage)"}),
        name: "webpage_import",
    },
];

export const slash_commands = [
    {
        text: $t({defaultMessage: "/dark (Toggle night mode)"}),
        name: "dark",
    },
    {
        text: $t({defaultMessage: "/night (Toggle night mode)"}),
        name: "night",
    },
    {
        text: $t({defaultMessage: "/activate (Activate app to use)"}),
        name: "activate",
    },
];

export const slash_commands_admin = [
    {
        text: $t({defaultMessage: "/dark (Toggle night mode)"}),
        name: "dark",
    },
    {
        text: $t({defaultMessage: "/day (Toggle day mode)"}),
        name: "day",
    },
    {
        text: $t({defaultMessage: "/fixed-width (Toggle fixed width mode)"}),
        name: "fixed-width",
    },
    {
        text: $t({defaultMessage: "/fluid-width (Toggle fluid width mode)"}),
        name: "fluid-width",
    },
    {
        text: $t({defaultMessage: "/invite (Invite wosetter to app)"}),
        name: "invite",
    },
    {
        text: $t({defaultMessage: "/light (Toggle day mode)"}),
        name: "light",
    },
    {
        text: $t({defaultMessage: "/me is excited (Display action text)"}),
        name: "me",
    },
    {
        text: $t({defaultMessage: "/night (Toggle night mode)"}),
        name: "night",
    },
    {
        text: $t({defaultMessage: "/poll Where should we go to lunch today? (Create a poll)"}),
        name: "poll",
    },
    {
        text: $t({defaultMessage: "/settings (Load settings menu)"}),
        name: "settings",
    },
    {
        text: $t({defaultMessage: "/todo (Create a todo list)"}),
        name: "todo",
    },
    {
        text: $t({defaultMessage: "/accounting_closing_term (Summary earning and new term of tasks)"}),
        name: "accounting_closing_term",
    },
    {
        text: $t({defaultMessage: "/accounting_deposit [vnd_number] //Comment Momo, Vietcombank (Deposit for increase account)"}),
        name: "accounting_deposit",
    },
    {
        text: $t({defaultMessage: "/accounting_miscellaneous [Project id] [vnd_fee] //Comment Paypal fee, Bank fee, Discount (Set miscellaneous fee for project)"}),
        name: "accounting_miscellaneous",
    },
    {
        text: $t({defaultMessage: "/accounting_request (Request for payment)"}),
        name: "accounting_request",
    },
    {
        text: $t({defaultMessage: "/accounting_withdrawal [vnd_money] //Comment (Withdrawal money from account)"}),
        name: "accounting_withdrawal",
    },
    {
        text: $t({defaultMessage: "/archive_stream (Archive stream and close)"}),
        name: "archive_stream",
    },
    {
        text: $t({defaultMessage: "/finish_task (Finish task of work)"}),
        name: "finish_task",
    },
    {
        text: $t({defaultMessage: "/fix_editor (Fix editor to classic)"}),
        name: "fix_editor",
    },
    {
        text: $t({defaultMessage: "/get_task (Get task for work)"}),
        name: "get_task",
    },
    {
        text: $t({defaultMessage: "/new_content (Create new content request)"}),
        name: "new_content",
    },
    {
        text: $t({defaultMessage: "/new_smart [tab_name*] -w [website] (Create new smart sheet request)"}),
        name: "new_smart",
    },
    {
        text: $t({defaultMessage: "/new_webpage (Create new webpage request)"}),
        name: "new_webpage",
    },
    {
        text: $t({defaultMessage: "/notify_disable [Email] //Command (Disable notification of contact)"}),
        name: "notify_disable",
    },
    {
        text: $t({defaultMessage: "/sk [-email(none) -sms] [Message] (Send to contact)"}),
        name: "sk",
    },
    {
        text: $t({defaultMessage: "/sk_info (Get contact information)"}),
        name: "sk_info",
    },
    {
        text: $t({defaultMessage: "/sk_set  [department: hr/support] [type: email/phone] [contact details: dan.nt@working24.net/0916666888] (Set stream to contact list)"}),
        name: "sk_set",
    },
    {
        text: $t({defaultMessage: "/summary (Summary this topic)"}),
        name: "summary",
    },
    {
        text: $t({defaultMessage: "/team_accept (Accept new member)"}),
        name: "team_accept",
    },
    {
        text: $t({defaultMessage: "/team_exit //Reason (Exit action for member from workflow)"}),
        name: "team_exit",
    },
    {
        text: $t({defaultMessage: "/team_level [level]* //comment (Set level for member)"}),
        name: "team_level",
    },
    {
        text: $t({defaultMessage: "/team_merge [new_stream_id]* (Merge stream, account, email to new one for member)"}),
        name: "team_merge",
    },
    {
        text: $t({defaultMessage: "/team_set `[payment/retain]* [value]* (Set payment, retain for member)"}),
        name: "team_set",
    },
    {
        text: $t({defaultMessage: "/test_command (Test command for admin)"}),
        name: "test_command",
    },
    {
        text: $t({defaultMessage: "/update [help/billing] (Update information or notes)"}),
        name: "update",
    },
    {
        text: $t({defaultMessage: "/work_cancel [Work_link] [None/Edit] //Comment for member (Cancel work of member)"}),
        name: "work_cancel",
    },
];

export function filter_and_sort_mentions(is_silent, query, opts) {
    opts = {
        want_broadcast: !is_silent,
        filter_pills: false,
        ...opts,
    };
    return get_person_suggestions(query, opts);
}

export function get_pm_people(query) {
    const opts = {
        want_broadcast: false,
        filter_pills: true,
    };
    return get_person_suggestions(query, opts);
}

export function get_person_suggestions(query, opts) {
    query = typeahead.clean_query_lowercase(query);

    function filter_persons(all_persons) {
        let persons;

        if (opts.filter_pills) {
            persons = compose_pm_pill.filter_taken_users(all_persons);
        } else {
            persons = all_persons;
        }
        // Exclude muted users from typeaheads.
        persons = muting.filter_muted_users(persons);

        if (opts.want_broadcast) {
            persons = persons.concat(broadcast_mentions());
        }

        return persons.filter((item) => query_matches_person(query, item));
    }

    const groups = user_groups.get_realm_user_groups();

    const filtered_groups = groups.filter((item) => query_matches_name_description(query, item));

    /*
        Let's say you're on a big realm and type
        "st" in a typeahead.  Maybe there are like
        30 people named Steve/Stephanie/etc.  We don't
        want those search results to squeeze out
        groups like "staff", and we also want to
        prefer Steve Yang over Stan Adams if the
        former has sent messages recently, despite
        the latter being first alphabetically.

        Also, from a performance standpoint, we can
        save some expensive work if we get enough
        matches from the more selective group of
        people.

        Note that we don't actually guarantee that we
        won't squeeze out groups here, but we make it
        less likely by removing some users from
        consideration.  (The sorting step will favor
        persons who match on prefix to groups who
        match on prefix.)
    */
    const cutoff_length = max_num_items;

    const filtered_message_persons = filter_persons(people.get_active_message_people());

    let filtered_persons;

    if (filtered_message_persons.length >= cutoff_length) {
        filtered_persons = filtered_message_persons;
    } else {
        filtered_persons = filter_persons(people.get_realm_users());
    }

    return typeahead_helper.sort_recipients({
        users: filtered_persons,
        query,
        current_stream: opts.stream,
        current_topic: opts.topic,
        groups: filtered_groups,
        max_num_items,
    });
}

export function get_stream_topic_data(hacky_this) {
    const opts = {};
    const message_row = hacky_this.$element.closest(".message_row");
    if (message_row.length === 1) {
        // we are editing a message so we try to use it's keys.
        const msg = message_store.get(rows.id(message_row));
        if (msg.type === "stream") {
            opts.stream = msg.stream;
            opts.topic = msg.topic;
        }
    } else {
        opts.stream = compose_state.stream_name();
        opts.topic = compose_state.topic();
    }
    return opts;
}

export function get_sorted_filtered_items(query) {
    /*
        This is just a "glue" function to work
        around bootstrap.  We want to control these
        three steps ourselves:

            - get data
            - filter data
            - sort data

        If we do it ourselves, we can convert some
        O(N) behavior to just O(1) time.

        For example, we want to avoid dispatching
        on completing every time through the loop, plus
        doing the same token cleanup every time.

        It's also a bit easier to debug typeahead when
        it's all one step, instead of three callbacks.

        (We did the same thing for search suggestions
        several years ago.)
    */

    const fetcher = get_candidates.bind(this);
    const big_results = fetcher(query);

    if (!big_results) {
        return false;
    }

    // We are still hacking info onto the "this" from
    // bootstrap.  Yuck.
    const completing = this.completing;
    const token = this.token;

    const opts = get_stream_topic_data(this);

    if (completing === "mention" || completing === "silent_mention") {
        return filter_and_sort_mentions(big_results.is_silent, token, opts);
    }

    return filter_and_sort_candidates(completing, big_results, token);
}

export function filter_and_sort_candidates(completing, candidates, token) {
    const matcher = compose_content_matcher(completing, token);

    const small_results = candidates.filter((item) => matcher(item));

    const sorted_results = sort_results(completing, small_results, token);

    return sorted_results;
}

export function get_candidates(query) {
    const split = split_at_cursor(query, this.$element);
    let current_token = tokenize_compose_str(split[0]);
    if (current_token === "") {
        return false;
    }
    const rest = split[1];

    // If the remaining content after the mention isn't a space or
    // punctuation (or end of the message), don't try to typeahead; we
    // probably just have the cursor in the middle of an
    // already-completed object.

    // We will likely want to extend this list to be more i18n-friendly.
    const terminal_symbols = ",.;?!()[]> \"'\n\t";
    if (rest !== "" && !terminal_symbols.includes(rest[0])) {
        return false;
    }

    // Start syntax highlighting autocompleter if the first three characters are ```
    const syntax_token = current_token.slice(0, 3);
    if (this.options.completions.syntax && (syntax_token === "```" || syntax_token === "~~~")) {
        // Only autocomplete if user starts typing a language after ```
        if (current_token.length === 3) {
            return false;
        }

        // If the only input is a space, don't autocomplete
        current_token = current_token.slice(3);
        if (current_token === " ") {
            return false;
        }

        // Trim the first whitespace if it is there
        if (current_token[0] === " ") {
            current_token = current_token.slice(1);
        }
        this.completing = "syntax";
        this.token = current_token;
        return Object.keys(pygments_data.langs);
    }

    // Only start the emoji autocompleter if : is directly after one
    // of the whitespace or punctuation chars we split on.
    if (this.options.completions.emoji && current_token[0] === ":") {
        // We don't want to match non-emoji emoticons such
        // as :P or :-p
        // Also, if the user has only typed a colon and nothing after,
        // no need to match yet.
        if (/^:-.?$/.test(current_token) || /^:[^+a-z]?$/.test(current_token)) {
            return false;
        }
        // Don't autocomplete if there is a space following a ':'
        if (current_token[1] === " ") {
            return false;
        }
        this.completing = "emoji";
        this.token = current_token.slice(1);
        return emoji_collection;
    }

    if (this.options.completions.mention && current_token[0] === "@") {
        current_token = current_token.slice(1);
        this.completing = "mention";
        // Silent mentions
        let is_silent = false;
        if (current_token.startsWith("_")) {
            this.completing = "silent_mention";
            is_silent = true;
            current_token = current_token.slice(1);
        }
        current_token = filter_mention_name(current_token);
        if (!current_token) {
            this.completing = null;
            return false;
        }
        this.token = current_token;
        return {is_silent};
    }

    function get_slash_commands_data() {
      if ((page_params.is_admin || page_params.is_moderator) && compose_state.topic().match("^Kw-.*__.*")) {
        const commands = slash_commands_admin_keyword;
        return commands;
      } else if ((page_params.is_admin || page_params.is_moderator) && compose_state.topic().match("^Webpage__.*")) {
        const commands = slash_commands_admin_webpage;
        return commands;
      } else if ((page_params.is_admin || page_params.is_moderator) && (compose_state.topic().match("^project-.*") || compose_state.topic().match("^request-.*"))) {
        const commands = slash_commands_admin_project;
        return commands;
      } else if (page_params.is_admin || page_params.is_moderator) {
        const commands = slash_commands_admin;
        return commands;
      } else if (compose_state.topic() == "Chat" && !page_params.is_guest) {
        const commands = slash_commands_chat;
        return commands;
      } else if (compose_state.topic().match("^Kw-.*__.*") && !page_params.is_guest) {
        const commands = slash_commands_keyword;
        return commands;
      } else if (compose_state.topic().match("^project-.*") && page_params.is_guest) {
        const commands = slash_commands_project;
        return commands;
      } else if (compose_state.topic() == "workflow" && !page_params.is_guest) {
        const commands = slash_commands_workflow;
        return commands;
      } else {
        const commands = slash_commands;
        return commands;
      }
    }

    if (this.options.completions.slash && current_token[0] === "/") {
        current_token = current_token.slice(1);

        this.completing = "slash";
        this.token = current_token;
        return get_slash_commands_data();
    }

    if (this.options.completions.stream && current_token[0] === "#") {
        if (current_token.length === 1) {
            return false;
        }

        current_token = current_token.slice(1);
        if (current_token.startsWith("**")) {
            current_token = current_token.slice(2);
        }

        // Don't autocomplete if there is a space following a '#'
        if (current_token[0] === " ") {
            return false;
        }

        this.completing = "stream";
        this.token = current_token;
        return stream_data.get_unsorted_subs();
    }

    if (this.options.completions.topic) {
        // Stream regex modified from marked.js
        // Matches '#**stream name** >' at the end of a split.
        const stream_regex = /#\*\*([^*>]+)\*\*\s?>$/;
        const should_jump_inside_typeahead = stream_regex.test(split[0]);
        if (should_jump_inside_typeahead) {
            this.completing = "topic_jump";
            this.token = ">";
            // We return something so that the typeahead is shown, but ultimately
            return [""];
        }

        // Matches '#**stream name>some text' at the end of a split.
        const stream_topic_regex = /#\*\*([^*>]+)>([^*]*)$/;
        const should_begin_typeahead = stream_topic_regex.test(split[0]);
        if (should_begin_typeahead) {
            this.completing = "topic_list";
            const tokens = stream_topic_regex.exec(split[0]);
            if (tokens[1]) {
                const stream_name = tokens[1];
                this.token = tokens[2] || "";
                const topic_list = topics_seen_for(stream_name);
                if (should_show_custom_query(this.token, topic_list)) {
                    topic_list.push(this.token);
                }
                return topic_list;
            }
        }
    }
    if (this.options.completions.timestamp) {
        const time_jump_regex = /<time(:([^>]*?)>?)?$/;
        if (time_jump_regex.test(split[0])) {
            this.completing = "time_jump";
            return [$t({defaultMessage: "Mention a timezone-aware time"})];
        }
    }
    return false;
}

export function content_highlighter(item) {
    switch (this.completing) {
        case "emoji":
            return typeahead_helper.render_emoji(item);
        case "mention":
            return typeahead_helper.render_person_or_user_group(item);
        case "silent_mention":
            return typeahead_helper.render_person_or_user_group(item);
        case "slash":
            return typeahead_helper.render_typeahead_item({
                primary: item.text,
            });
        case "stream":
            return typeahead_helper.render_stream(item);
        case "syntax":
            return typeahead_helper.render_typeahead_item({primary: item});
        case "topic_jump":
            return typeahead_helper.render_typeahead_item({primary: item});
        case "topic_list":
            return typeahead_helper.render_typeahead_item({primary: item});
        case "time_jump":
            return typeahead_helper.render_typeahead_item({primary: item});
        default:
            return undefined;
    }
}

const show_flatpickr = (element, callback, default_timestamp) => {
    const flatpickr_input = $("<input id='#timestamp_flatpickr'>");

    const instance = flatpickr_input.flatpickr({
        mode: "single",
        enableTime: true,
        clickOpens: false,
        defaultDate: default_timestamp,
        plugins: [new ConfirmDatePlugin({})],
        positionElement: element,
        dateFormat: "Z",
        formatDate: (date) => formatISO(date),
    });
    const container = $($(instance.innerContainer).parent());
    container.on("click", ".flatpickr-calendar", (e) => {
        e.stopPropagation();
        e.preventDefault();
    });

    container.on("click", ".flatpickr-confirm", () => {
        callback(flatpickr_input.val());
        instance.close();
        instance.destroy();
    });
    instance.open();
    container.find(".flatpickr-monthDropdown-months").trigger("focus");
};

export function content_typeahead_selected(item, event) {
    const pieces = split_at_cursor(this.query, this.$element);
    let beginning = pieces[0];
    let rest = pieces[1];
    const textbox = this.$element;

    switch (this.completing) {
        case "emoji":
            // leading and trailing spaces are required for emoji,
            // except if it begins a message or a new line.
            if (
                beginning.lastIndexOf(":") === 0 ||
                beginning.charAt(beginning.lastIndexOf(":") - 1) === " " ||
                beginning.charAt(beginning.lastIndexOf(":") - 1) === "\n"
            ) {
                beginning =
                    beginning.slice(0, -this.token.length - 1) + ":" + item.emoji_name + ": ";
            } else {
                beginning =
                    beginning.slice(0, -this.token.length - 1) + " :" + item.emoji_name + ": ";
            }
            break;
        case "silent_mention":
        case "mention": {
            const is_silent = this.completing === "silent_mention";
            beginning = beginning.slice(0, -this.token.length - 1);
            if (beginning.endsWith("@_*")) {
                beginning = beginning.slice(0, -3);
            } else if (beginning.endsWith("@*") || beginning.endsWith("@_")) {
                beginning = beginning.slice(0, -2);
            } else if (beginning.endsWith("@")) {
                beginning = beginning.slice(0, -1);
            }
            if (user_groups.is_user_group(item)) {
                let user_group_mention_text = is_silent ? "@_*" : "@*";
                user_group_mention_text += item.name + "* ";
                beginning += user_group_mention_text;
                // We could theoretically warn folks if they are
                // mentioning a user group that literally has zero
                // members where we are posting to, but we don't have
                // that functionality yet, and we haven't gotten much
                // feedback on this being an actual pitfall.
            } else {
                const mention_text = people.get_mention_syntax(
                    item.full_name,
                    item.user_id,
                    is_silent,
                );
                beginning += mention_text + " ";
                if (!is_silent) {
                    compose.warn_if_mentioning_unsubscribed_user(item);
                }
            }
            break;
        }
        case "slash":
            beginning = beginning.slice(0, -this.token.length - 1) + "/" + item.name + " ";
            break;
        case "stream":
            beginning = beginning.slice(0, -this.token.length - 1);
            if (beginning.endsWith("#*")) {
                beginning = beginning.slice(0, -2);
            }
            beginning += "#**" + item.name;
            if (event && event.key === ">") {
                // Normally, one accepts typeahead with `Tab` or `Enter`, but when completing
                // stream typeahead, we allow `>`, the delimiter for stream+topic mentions,
                // as a completion that automatically sets up stream+topic typeahead for you.
                beginning += ">";
            } else {
                beginning += "** ";
            }
            compose.warn_if_private_stream_is_linked(item);
            break;
        case "syntax": {
            // Isolate the end index of the triple backticks/tildes, including
            // possibly a space afterward
            const backticks = beginning.length - this.token.length;
            if (rest === "") {
                // If cursor is at end of input ("rest" is empty), then
                // complete the token before the cursor, and add a closing fence
                // after the cursor
                beginning = beginning.slice(0, backticks) + item + "\n";
                rest = "\n" + beginning.slice(Math.max(0, backticks - 4), backticks).trim() + rest;
            } else {
                // If more text after the input, then complete the token, but don't touch
                // "rest" (i.e. do not add a closing fence)
                beginning = beginning.slice(0, backticks) + item;
            }
            break;
        }
        case "topic_jump": {
            // Put the cursor at the end of immediately preceding stream mention syntax,
            // just before where the `**` at the end of the syntax.  This will delete that
            // final ** and set things up for the topic_list typeahead.
            const index = beginning.lastIndexOf("**");
            if (index !== -1) {
                beginning = beginning.slice(0, index) + ">";
            }
            break;
        }
        case "topic_list": {
            // Stream + topic mention typeahead; close the stream+topic mention syntax
            // with the topic and the final **.  Note that this.token.length can be 0
            // if we are completing from `**streamname>`.
            const start = beginning.length - this.token.length;
            beginning = beginning.slice(0, start) + item + "** ";
            break;
        }
        case "time_jump": {
            let timestring = beginning.slice(Math.max(0, beginning.lastIndexOf("<time:")));
            if (timestring.startsWith("<time:") && timestring.endsWith(">")) {
                timestring = timestring.slice(6, -1);
            }
            const timestamp = timerender.get_timestamp_for_flatpickr(timestring);

            const on_timestamp_selection = (val) => {
                const datestr = val;
                beginning =
                    beginning.slice(0, Math.max(0, beginning.lastIndexOf("<time"))) +
                    `<time:${datestr}> `;
                if (rest.startsWith(">")) {
                    rest = rest.slice(1);
                }
                textbox.val(beginning + rest);
                textbox.caret(beginning.length, beginning.length);
                compose_ui.autosize_textarea(textbox);
            };
            show_flatpickr(this.$element[0], on_timestamp_selection, timestamp);
            return beginning + rest;
        }
    }

    // Keep the cursor after the newly inserted text, as Bootstrap will call textbox.change() to
    // overwrite the text in the textbox.
    setTimeout(() => {
        textbox.caret(beginning.length, beginning.length);
        // Also, trigger autosize to check if compose box needs to be resized.
        compose_ui.autosize_textarea(textbox);
    }, 0);
    return beginning + rest;
}

export function compose_content_matcher(completing, token) {
    switch (completing) {
        case "emoji":
            return typeahead.get_emoji_matcher(token);
        case "slash":
            return get_slash_matcher(token);
        case "stream":
            return get_stream_or_user_group_matcher(token);
        case "syntax":
            return get_language_matcher(token);
        case "topic_list":
            return get_topic_matcher(token);
    }

    return function () {
        switch (completing) {
            case "topic_jump":
            case "time_jump":
                // these don't actually have a typeahead popover, so we return quickly here.
                return true;
            default:
                return undefined;
        }
    };
}

export function sort_results(completing, matches, token) {
    switch (completing) {
        case "emoji":
            return typeahead.sort_emojis(matches, token);
        case "slash":
            return typeahead_helper.sort_slash_commands(matches, token);
        case "stream":
            return typeahead_helper.sort_streams(matches, token);
        case "syntax":
            return typeahead_helper.sort_languages(matches, token);
        case "topic_jump":
        case "time_jump":
            // topic_jump doesn't actually have a typeahead popover, so we return quickly here.
            return matches;
        case "topic_list":
            return typeahead_helper.sorter(token, matches, (x) => x);
        default:
            return undefined;
    }
}

export function compose_automated_selection() {
    if (this.completing === "topic_jump") {
        // automatically jump inside stream mention on typing > just after
        // a stream mention, to begin stream+topic mention typeahead (topic_list).
        return true;
    }
    return false;
}

export function compose_trigger_selection(event) {
    if (this.completing === "stream" && event.key === ">") {
        // complete stream typeahead partially to immediately start the topic_list typeahead.
        return true;
    }
    return false;
}

function get_header_html() {
    let tip_text = "";
    switch (this.completing) {
        case "stream":
            tip_text = $t({defaultMessage: "Press > for list of topics"});
            break;
        case "silent_mention":
            tip_text = $t({defaultMessage: "Silent mentions do not trigger notifications."});
            break;
        case "syntax":
            if (page_params.realm_default_code_block_language !== null) {
                tip_text = $t(
                    {defaultMessage: "Default is {language}. Use 'text' to disable highlighting."},
                    {language: page_params.realm_default_code_block_language},
                );
                break;
            }
            return false;
        default:
            return false;
    }
    return `<em>${_.escape(tip_text)}</em>`;
}

export function initialize_compose_typeahead(selector) {
    const completions = {
        mention: true,
        emoji: true,
        silent_mention: true,
        slash: true,
        stream: true,
        syntax: true,
        topic: true,
        timestamp: true,
    };

    $(selector).typeahead({
        items: max_num_items,
        dropup: true,
        fixed: true,
        // Performance note: We have trivial matcher/sorters to do
        // matching and sorting inside the `source` field to avoid
        // O(n) behavior in the number of users in the organization
        // inside the typeahead library.
        source: get_sorted_filtered_items,
        highlighter: content_highlighter,
        matcher() {
            return true;
        },
        sorter(items) {
            return items;
        },
        updater: content_typeahead_selected,
        stopAdvance: true, // Do not advance to the next field on a Tab or Enter
        completions,
        automated: compose_automated_selection,
        trigger_selection: compose_trigger_selection,
        header: get_header_html,
    });
}

export function initialize() {
    update_emoji_data();

    // These handlers are at the "form" level so that they are called after typeahead
    $("form#send_message_form").on("keydown", handle_keydown);
    $("form#send_message_form").on("keyup", handle_keyup);

    $("#enter_sends").on("click", () => {
        const send_button = $("#compose-send-button");
        page_params.enter_sends = $("#enter_sends").is(":checked");
        if (page_params.enter_sends) {
            send_button.fadeOut();
        } else {
            send_button.fadeIn();
        }

        // Refocus in the content box so you can continue typing or
        // press Enter to send.
        $("#compose-textarea").trigger("focus");

        return channel.post({
            url: "/json/users/me/enter-sends",
            idempotent: true,
            data: {enter_sends: page_params.enter_sends},
        });
    });
    $("#enter_sends").prop("checked", page_params.enter_sends);
    if (page_params.enter_sends) {
        $("#compose-send-button").hide();
    }

    // limit number of items so the list doesn't fall off the screen
    $("#stream_message_recipient_stream").typeahead({
        source() {
            return stream_data.subscribed_streams();
        },
        items: 3,
        fixed: true,
        highlighter(item) {
            return typeahead_helper.render_typeahead_item({primary: item});
        },
        matcher(item) {
            // The matcher for "stream" is strictly prefix-based,
            // because we want to avoid mixing up streams.
            const q = this.query.trim().toLowerCase();
            return item.toLowerCase().startsWith(q);
        },
    });

    $("#stream_message_recipient_topic").typeahead({
        source() {
            const stream_name = compose_state.stream_name();
            return topics_seen_for(stream_name);
        },
        items: 3,
        fixed: true,
        highlighter(item) {
            return typeahead_helper.render_typeahead_item({primary: item});
        },
        sorter(items) {
            const sorted = typeahead_helper.sorter(this.query, items, (x) => x);
            if (sorted.length > 0 && !sorted.includes(this.query)) {
                sorted.unshift(this.query);
            }
            return sorted;
        },
    });

    $("#private_message_recipient").typeahead({
        source: get_pm_people,
        items: max_num_items,
        dropup: true,
        fixed: true,
        highlighter(item) {
            return typeahead_helper.render_person_or_user_group(item);
        },
        matcher() {
            return true;
        },
        sorter(items) {
            return items;
        },
        updater(item) {
            if (user_groups.is_user_group(item)) {
                for (const user_id of item.members) {
                    const user = people.get_by_user_id(user_id);
                    // filter out inserted users and current user from pill insertion
                    const inserted_users = user_pill.get_user_ids(compose_pm_pill.widget);
                    const current_user = people.is_current_user(user.email);
                    if (!inserted_users.includes(user.user_id) && !current_user) {
                        compose_pm_pill.set_from_typeahead(user);
                    }
                }
                // clear input pill in the event no pills were added
                const pill_widget = compose_pm_pill.widget;
                if (pill_widget.clear_text !== undefined) {
                    pill_widget.clear_text();
                }
            } else {
                compose_pm_pill.set_from_typeahead(item);
            }
        },
        stopAdvance: true, // Do not advance to the next field on a Tab or Enter
    });

    initialize_compose_typeahead("#compose-textarea");

    $("#private_message_recipient").on("blur", function () {
        const val = $(this).val();
        const recipients = typeahead_helper.get_cleaned_pm_recipients(val);
        $(this).val(recipients.join(", "));
    });
}
