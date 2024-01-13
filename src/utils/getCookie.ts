import Axios, { AxiosRequestConfig } from "axios";
import { Credentials, TwitterRequestHeaders } from "../types/twitter";

const loginURL: string = `https://api.twitter.com/1.1/onboarding/task.json`;

export const getCookie = async (credentials: Credentials, authorization: string, guestToken: string, timeout: number) => {
    try {
        return await fetchCookie(credentials, authorization, guestToken, timeout);
    } catch (e) {
        return undefined;
    }
};

const fetchCookie = async (credentials: Credentials, authorization: string, guestToken: string, timeout: number) => {
    if (!credentials || !credentials.username || !credentials.password) {
        throw new Error("Credentials required for login!");
    }

    const headers: Partial<TwitterRequestHeaders> = {
        Authorization: authorization,
        Connection: "Keep-Alive",
        "Content-Type": "application/json;charset=UTF-8",
        "User-Agent": "TwitterAndroid/99",
        "X-Guest-Token": guestToken,
        "X-Twitter-Auth-Type": "OAuth2Client",
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Client-Language": "en",
    };

    const requestConfig: AxiosRequestConfig = {
        method: "post",
        withCredentials: true,
        timeout: timeout,
        headers: headers,
    };

    // step start
    const data4Start = {
        flow_name: "login",
        input_flow_data: {
            flow_context: {
                debug_overrides: {},
                start_location: { location: "splash_screen" },
            },
        },
    };

    let flowToken: string,
        cookie: string[],
        cookies: string[] = [];

    ({ flowToken, cookie } = await updateFlowTokenAndCookie(requestConfig, data4Start));

    if (cookie) {
        cookies = cookies.concat(cookie);
    } else {
        throw new Error("Failed to get cookie for login!");
    }

    requestConfig.headers.cookie = getCookieString(cookies);

    // step second
    const data4StepSecond = {
        flow_token: flowToken,
        subtask_inputs: [
            {
                subtask_id: "LoginJsInstrumentationSubtask",
                js_instrumentation: { response: "{}", link: "next_link" },
            },
        ],
    };
    ({ flowToken, cookie } = await updateFlowTokenAndCookie(requestConfig, data4StepSecond));

    // step third
    const data4StepThird = {
        flow_token: flowToken,
        subtask_inputs: [
            {
                subtask_id: "LoginEnterUserIdentifierSSO",
                settings_list: {
                    setting_responses: [
                        {
                            key: "user_identifier",
                            response_data: { text_data: { result: credentials.username } },
                        },
                    ],
                    link: "next_link",
                },
            },
        ],
    };
    ({ flowToken, cookie } = await updateFlowTokenAndCookie(requestConfig, data4StepThird));

    // step fourth
    const data4StepFourth = {
        flow_token: flowToken,
        subtask_inputs: [
            {
                subtask_id: "LoginEnterPassword",
                enter_password: { password: credentials.password, link: "next_link" },
            },
        ],
    };
    ({ flowToken, cookie } = await updateFlowTokenAndCookie(requestConfig, data4StepFourth));

    // step fifth
    const data4StepFifth = {
        flow_token: flowToken,
        subtask_inputs: [
            {
                subtask_id: "AccountDuplicationCheck",
                check_logged_in_account: { link: "AccountDuplicationCheck_false" },
            },
        ],
    };
    try {
        ({ flowToken, cookie } = await updateFlowTokenAndCookie(requestConfig, data4StepFifth));
    } catch (e) {
        const subtaskId = needVerificationCode(e?.message, credentials?.verificationCode);
        if (!subtaskId) {
            throw e;
        }

        if (!credentials?.verificationCode) {
            throw new Error("Verification Code required for login!");
        }

        // step for possible confirmation
        const data4StepConfirmation = {
            flow_token: flowToken,
            subtask_inputs: [
                {
                    subtask_id: subtaskId,
                    enter_text: { text: credentials.verificationCode, link: "next_link" },
                },
            ],
        };

        ({ flowToken, cookie } = await updateFlowTokenAndCookie(requestConfig, data4StepConfirmation));
    }

    if (cookie) {
        cookies = cookies.concat(cookie);
    }

    return getCookieString(cookies);
};

const updateFlowTokenAndCookie = async (
    requestConfig: AxiosRequestConfig,
    data: unknown
): Promise<{
    flowToken: string;
    cookie: string[];
}> => {
    const res = await Axios.post(loginURL, JSON.stringify(data), requestConfig);
    return { flowToken: res?.data?.flow_token, cookie: res?.headers["set-cookie"] };
};

const needVerificationCode = (errorMessage?: string, verificationCode?: string): string => {
    const ERR_LOGIN_ACID = "LoginAcid";
    const ERR_2FA_CHALLENGE = "LoginTwoFactorAuthChallenge";

    let subtask = "";
    if (!errorMessage) {
        return subtask;
    }
    if (errorMessage.includes(ERR_LOGIN_ACID)) {
        subtask = ERR_LOGIN_ACID;
    } else if (errorMessage.includes(ERR_2FA_CHALLENGE)) {
        subtask = ERR_2FA_CHALLENGE;
    }

    if (subtask && !verificationCode) {
        throw new Error("Verification Code required for login!");
    }

    return subtask;
};

const getCookieString = (cookies: string[]): string => {
    if (!cookies) {
        return null;
    }
    // Parse each cookie
    const parsed = cookies.map((cookieStr: string) => {
        const split = cookieStr.split(";");
        const effectiveCookie = split[0].split(/=(.*)/, 2);
        return {
            name: effectiveCookie[0],
            value: effectiveCookie[1],
            domain: split.find((part) => part.includes("Domain=")).split("=")[1],
        };
    });

    // Filter by twitter
    const twitterCookies = parsed.filter((triple) => triple.domain === ".twitter.com");

    // Construct string
    return twitterCookies
        .map((cookie) => {
            return `${cookie.name}=${cookie.value}`;
        })
        .join(";");
};
