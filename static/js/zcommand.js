import $ from "jquery";

import marked from "../third/marked/lib/marked";

import * as browser_history from "./browser_history";
import * as channel from "./channel";
import * as common from "./common";
import * as feedback_widget from "./feedback_widget";
import {$t} from "./i18n";
import * as night_mode from "./night_mode";
import * as scroll_bar from "./scroll_bar";

import * as message_lists from "./message_lists";
import * as compose_state from "./compose_state";
import * as people from "./people";
import * as stream_data from "./stream_data";

/*

What in the heck is a zcommand?

    A zcommand is basically a specific type of slash
    command where the client does almost no work and
    the server just does something pretty simple like
    flip a setting.

    The first zcommand we wrote is for "/ping", and
    the server just responds with a 200 for that.

    Not all slash commands use zcommand under the hood.
    For more exotic things like /poll see submessage.js
    and widgetize.js

*/

function send_webhook(hook_temp_url, text) {
    var hook_url = hook_temp_url;
    var hook_text = text.split(/^\/\S*/)[1].trim();

    const message = message_lists.current.selected_message();
    const stream_name = compose_state.stream_name();
    const stream_id = stream_data.get_stream_id(stream_name);
    const topic_name = compose_state.topic();
    const user_id = people.get_by_user_id(people.my_current_user_id());
  
    $.ajax
    ({
        type: "POST",
        //the url where you want to sent the userName and password to
        url: hook_url,
        dataType: 'text/plain',
        async: false,
        //json object to sent to the authentication url
        data: {
          text: hook_text,
          message: message,
          stream: stream_name,
          stream_id: stream_id,
          topic: topic_name,
          user_id: user_id
        }
    })  
}

export function send(opts) {
    const command = opts.command;
    const on_success = opts.on_success;
    const data = {
        command,
    };

    channel.post({
        url: "/json/zcommand",
        data,
        success(data) {
            if (on_success) {
                on_success(data);
            }
        },
        error() {
            tell_user("server did not respond");
        },
    });
}

export function tell_user(msg) {
    // This is a bit hacky, but we don't have a super easy API now
    // for just telling users stuff.
    $("#compose-send-status")
        .removeClass(common.status_classes)
        .addClass("alert-error")
        .stop(true)
        .fadeTo(0, 1);
    $("#compose-error-msg").text(msg);
}

export function enter_day_mode() {
    send({
        command: "/day",
        on_success(data) {
            night_mode.disable();
            feedback_widget.show({
                populate(container) {
                    const rendered_msg = marked(data.msg).trim();
                    container.html(rendered_msg);
                },
                on_undo() {
                    send({
                        command: "/night",
                    });
                },
                title_text: $t({defaultMessage: "Day mode"}),
                undo_button_text: $t({defaultMessage: "Night"}),
            });
        },
    });
}

export function enter_night_mode() {
    send({
        command: "/night",
        on_success(data) {
            night_mode.enable();
            feedback_widget.show({
                populate(container) {
                    const rendered_msg = marked(data.msg).trim();
                    container.html(rendered_msg);
                },
                on_undo() {
                    send({
                        command: "/day",
                    });
                },
                title_text: $t({defaultMessage: "Night mode"}),
                undo_button_text: $t({defaultMessage: "Day"}),
            });
        },
    });
}

export function enter_fluid_mode() {
    send({
        command: "/fluid-width",
        on_success(data) {
            scroll_bar.set_layout_width();
            feedback_widget.show({
                populate(container) {
                    const rendered_msg = marked(data.msg).trim();
                    container.html(rendered_msg);
                },
                on_undo() {
                    send({
                        command: "/fixed-width",
                    });
                },
                title_text: $t({defaultMessage: "Fluid width mode"}),
                undo_button_text: $t({defaultMessage: "Fixed width"}),
            });
        },
    });
}

export function enter_fixed_mode() {
    send({
        command: "/fixed-width",
        on_success(data) {
            scroll_bar.set_layout_width();
            feedback_widget.show({
                populate(container) {
                    const rendered_msg = marked(data.msg).trim();
                    container.html(rendered_msg);
                },
                on_undo() {
                    send({
                        command: "/fluid-width",
                    });
                },
                title_text: $t({defaultMessage: "Fixed width mode"}),
                undo_button_text: $t({defaultMessage: "Fluid width"}),
            });
        },
    });
}

export function process(message_content) {
    const content = message_content.trim();

    if (content === "/ping") {
        const start_time = new Date();

        send({
            command: content,
            on_success() {
                const end_time = new Date();
                let diff = end_time - start_time;
                diff = Math.round(diff);
                const msg = "ping time: " + diff + "ms";
                tell_user(msg);
            },
        });
        return true;
    }

    const day_commands = ["/day", "/light"];
    if (day_commands.includes(content)) {
        enter_day_mode();
        return true;
    }

    const night_commands = ["/night", "/dark"];
    if (night_commands.includes(content)) {
        enter_night_mode();
        return true;
    }

    if (content === "/fluid-width") {
        enter_fluid_mode();
        return true;
    }

    if (content === "/fixed-width") {
        enter_fixed_mode();
        return true;
    }

    if (content === "/settings") {
        browser_history.go_to_location("settings/your-account");
        return true;
    }
    
    var hook_temp_url = "";
    if (content.match(/^\/accounting_closing_term/g)) {
        hook_temp_url = "https://io.working24.net/webhook/ee248bb9-d76d-47ec-80a4-5201a17661d6";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/accounting_deposit/g)) {
        hook_temp_url = "https://io.working24.net/webhook/3e5a9858-5df1-4644-8435-bf786e8c0088";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/accounting_miscellaneous/g)) {
        hook_temp_url = "https://io.working24.net/webhook/f6153420-e34b-42bd-aa08-7835aa8f2ed3";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/accounting_request/g)) {
        hook_temp_url = "https://io.working24.net/webhook/d180ede4-6809-40b0-9707-8ff5ec47a3e2";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/accounting_withdrawal/g)) {
        hook_temp_url = "https://io.working24.net/webhook/1d4595c1-d37d-4f5d-a1a3-b51f860c6665";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/activate/g)) {
        hook_temp_url = "https://io.working24.net/webhook/4c67ac3c-bcda-4d1e-8999-8ce1b8464fe1";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/archive/g)) {
        hook_temp_url = "https://io.working24.net/webhook/4aa0e344-1961-4f7f-8186-927fa41d954f";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/finish_task/g)) {
        hook_temp_url = "https://io.working24.net/webhook/5145529e-3ffa-4d33-840a-8e58655ba5c7";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/fix_editor/g)) {
        hook_temp_url = "https://io.working24.net/webhook/3809c69e-9dd3-4ccb-9ce2-7d3ccc1b04e8";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/get_task/g)) {
        hook_temp_url = "https://io.working24.net/webhook/636b4b22-4e22-4109-bc43-ad68ebbabedf";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/invite/g)) {
        hook_temp_url = "https://io.working24.net/webhook/4f5b6544-e37f-4da0-9e82-cf9be90f7307";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/keyword_link/g)) {
        hook_temp_url = "https://io.working24.net/webhook/2093d6d9-c0e6-41dd-8e1e-3e7759893fff";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/keyword_negative/g)) {
        hook_temp_url = "https://io.working24.net/webhook/d08636d2-d010-44fb-b95f-c41d7e80e986";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/keyword_seed/g)) {
        hook_temp_url = "https://io.working24.net/webhook/7c655c23-4daf-4e1d-bbb0-61439e3591f0";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/keyword_submit/g)) {
        hook_temp_url = "https://io.working24.net/webhook/57425ecc-15af-4856-8c1b-74ef3162fbe8";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/keyword_update/g)) {
        hook_temp_url = "https://io.working24.net/webhook/88ea438c-3ac8-410b-9aa7-b01d3c7c9a4d";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/new_content/g)) {
        hook_temp_url = "https://io.working24.net/webhook/19535841-ef5a-41fd-adcd-cd94aa7854b7";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/new_smart/g)) {
        hook_temp_url = "https://io.working24.net/webhook/63c0c768-bd0c-4acf-b4d1-819557e4b346";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/new_webpage/g)) {
        hook_temp_url = "https://io.working24.net/webhook/97b8c551-07f7-404d-b1e7-fc7e4c077d67";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/notify_disable/g)) {
        hook_temp_url = "https://io.working24.net/webhook/71addcb6-94d9-4601-bac7-483bb8968039";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/project_activate/g)) {
        hook_temp_url = "https://io.working24.net/webhook/25bfee92-79ec-472c-9f11-2049ec81449b";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/project_cancel/g)) {
        hook_temp_url = "https://io.working24.net/webhook/763d98df-2410-45a9-be8a-e2f2a9b1ffcb";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/project_set/g)) {
        hook_temp_url = "https://io.working24.net/webhook/fabd4520-e603-43bf-bb90-b669a3a5d56c";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/sk\s/g)) {
        hook_temp_url = "https://io.working24.net/webhook/51cdf3fc-6264-463e-94a6-acc29e6a1d76";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/sk_comment/g)) {
        hook_temp_url = "https://io.working24.net/webhook/679c5497-cbb7-4316-9804-5b181566eb7c";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/sk_info/g)) {
        hook_temp_url = "https://io.working24.net/webhook/433ea90a-86dd-4603-ba68-779873303601";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/sk_set/g)) {
        hook_temp_url = "https://io.working24.net/webhook/1bf735a6-e47f-4ba7-bb81-354d5deed8b1";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/summary/g)) {
        hook_temp_url = "https://io.working24.net/webhook/1b0db57c-5f03-4ef6-9a3b-28cc83e4d45d";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/task_note/g)) {
        hook_temp_url = "https://io.working24.net/webhook/b29005f8-d838-4770-baf1-4c578123697e";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/team_accept/g)) {
        hook_temp_url = "https://io.working24.net/webhook/a4aeb410-df6b-4f73-b9ad-47ae951332ec";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/team_level/g)) {
        hook_temp_url = "https://io.working24.net/webhook/a7a62faa-eca0-497d-a687-6ab546dbf48c";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/team_exit/g)) {
        hook_temp_url = "https://io.working24.net/webhook/8b14d9b2-ca24-4e20-a0ba-cf1a113a0fbd";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/team_merge/g)) {
        hook_temp_url = "https://io.working24.net/webhook/c1b8c718-9041-47b5-a254-3544fcc9b67c";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/test_command/g)) {
        hook_temp_url = "https://io.working24.net/webhook-test/6fda4fa6-77f2-41a9-a0d3-3c37ac2a8e91";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/update/g)) {
        hook_temp_url = "https://io.working24.net/webhook/d9d827ed-3368-4b0b-b985-4b5b9bf9820e";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/webpage_activate/g)) {
        hook_temp_url = "https://io.working24.net/webhook/cfbda8ac-d66b-4a9e-9545-9303ffa4cf4d";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/webpage_hosting/g)) {
        hook_temp_url = "https://io.working24.net/webhook/84ea8b1b-f262-423e-ae80-862ac445bb66";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/webpage_import/g)) {
        hook_temp_url = "https://io.working24.net/webhook/24f6cbaa-eb07-4bcb-9fdf-51d7f4ccea82";
        send_webhook(hook_temp_url, content);
        return true;
    } else if (content.match(/^\/work_cancel/g)) {
        hook_temp_url = "https://io.working24.net/webhook/7111958b-3904-4dbb-bb40-c766d1e61119";
        send_webhook(hook_temp_url, content);
        return true;
    }

    // It is incredibly important here to return false
    // if we don't see an actual zcommand, so that compose.js
    // knows this is a normal message.
    return false;
}
