import Axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { Twitter, VideoVariants, Author, Statistics, Media, Config, Credentials, TwitterRequestHeaders } from "../types/twitter";
import { getGuestToken, getAuthorization, getCookie } from "./index";

const _twitterapi = `https://twitter.com/i/api/graphql/DJS3BdhUhcaEpZ7B7irJDg/TweetResultByRestId`;
const variables = (id: string) => {
    return { tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false };
};
const features = {
    creator_subscriptions_tweet_preview_api_enabled: true,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: false,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_media_download_video_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_enhance_cards_enabled: false,
};

const millsToMinutesAndSeconds = (millis: number) => {
    const minutes = Math.floor(millis / 60000);
    const seconds = ((millis % 60000) / 1000).toFixed(0);
    return `${minutes}:${Number(seconds) < 10 ? "0" : ""}${seconds}`;
};

export const TwitterDL = async (url: string, config?: Config, credentials?: Credentials): Promise<Twitter> => {
    const id = url.match(/\/([\d]+)/);
    const regex = /^(https?:\/\/)?(www\.)?(m\.)?(twitter|x)\.com\/\w+/;
    /** Validate */
    if (!regex.test(url)) throw new Error("Invalid twitter url!");
    if (!id) throw new Error("There was an error getting twitter id. Make sure your twitter url is correct!");
    const authorization = config?.authorization ? config.authorization : await getAuthorization();

    const timeout: number = 30000;
    const guest_token: string = await getGuestToken(authorization);

    if (!guest_token)
        return {
            status: "error",
            message: "Failed to get Guest Token. Authorization is invalid!",
        };

    const regExpMatcher = /(?:^|; |;)ct0=([^;]*)/;
    const csrfTokenArray = config?.cookie ? config.cookie.match(regExpMatcher) : "";
    const headers: Partial<TwitterRequestHeaders> = {
        Authorization: authorization,
        "x-csrf-token": csrfTokenArray ? csrfTokenArray[1] : "",
        "x-guest-token": guest_token,
        "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36",
    };

    const requestConfig: AxiosRequestConfig = {
        method: "GET",
        params: {
            variables: JSON.stringify(variables(id[1])),
            features: JSON.stringify(features),
        },
        headers: headers,
        timeout: timeout,
    };

    let data: AxiosResponse;
    let cookie: string;
    try {
        ({ data } = await Axios(_twitterapi, requestConfig));
        if (!data?.data?.tweetResult?.result) {
            return {
                status: "error",
                message: "Tweet not found!",
            };
        }
        if (data?.data?.tweetResult?.result?.reason === "NsfwLoggedOut") {
            cookie = await getCookie(credentials, authorization, guest_token, timeout);
            if (!cookie) {
                return {
                    status: "error",
                    message: "This tweet contains sensitive content!",
                };
            }
            const csrfTokenArray2 = cookie ? cookie.match(regExpMatcher) : "";
            requestConfig.headers["x-csrf-token"] = csrfTokenArray2 ? csrfTokenArray2[1] : "";
            /** Use Cookies to avoid errors */
            ({ data } = await Axios(_twitterapi, requestConfig));
            if (data.data.tweetResult.result?.reason === "NsfwLoggedOut") {
                return {
                    status: "error",
                    message: "This tweet contains sensitive content!",
                };
            }
        }
    } catch (e) {
        return {
            status: "error",
            message: e.message,
        };
    }

    return parseResponse(data, cookie ? cookie : config?.cookie);
};

const parseResponse = (data: AxiosResponse, cookie?: string): Twitter => {
    const result =
        data.data.tweetResult.result.__typename === "TweetWithVisibilityResults"
            ? data.data.tweetResult.result.tweet
            : data.data.tweetResult.result;
    const statistics: Statistics = {
        replieCount: result.legacy.reply_count,
        retweetCount: result.legacy.retweet_count,
        favoriteCount: result.legacy.favorite_count,
        viewCount: Number(result.views.count),
    };
    const user = result.core.user_results.result;
    const author: Author = {
        username: user.legacy.screen_name,
        bio: user.legacy.description,
        possiblySensitive: user.legacy.possibly_sensitive,
        verified: user.legacy.verified,
        location: user.legacy.location,
        profileBannerUrl: user.legacy.profile_banner_url,
        profileImageUrl: user.legacy.profile_image_url_https,
        url: "https://twitter.com/" + user.legacy.screen_name,
        statistics: {
            favoriteCount: user.legacy.favourites_count,
            followersCount: user.legacy.followers_count,
            friendsCount: user.legacy.friends_count,
            statusesCount: user.legacy.statuses_count,
            listedCount: user.legacy.listed_count,
            mediaCount: user.legacy.media_count,
        },
    };
    /** If there is no media, the Array will be empty */
    const media: Media[] =
        result.legacy?.entities?.media?.map((v: any) => {
            if (v.type === "photo") {
                return { type: v.type, image: v.media_url_https, expandedUrl: v.expanded_url };
            } else {
                const isGif = v.type === "animated_gif";
                const videos: VideoVariants[] = v.video_info.variants
                    .filter((video: any) => video.content_type === "video/mp4")
                    .map((variants: any) => {
                        const quality = isGif
                            ? `${v.original_info.width}x${v.original_info.height}`
                            : variants.url.match(/\/([\d]+x[\d]+)\//)[1];
                        return {
                            bitrate: variants.bitrate,
                            content_type: variants.content_type,
                            quality,
                            url: variants.url,
                        };
                    });
                return {
                    type: v.type,
                    cover: v.media_url_https,
                    duration: millsToMinutesAndSeconds(v.video_info.duration_millis),
                    expandedUrl: v.expanded_url,
                    videos,
                };
            }
        }) || [];
    return {
        status: "success",
        result: {
            id: result.legacy.id_str,
            createdAt: result.legacy.created_at,
            description: result.legacy.full_text,
            languange: result.legacy.lang,
            possiblySensitive: result.legacy.possibly_sensitive || false,
            possiblySensitiveEditable: result.legacy.possibly_sensitive_editable || false,
            isQuoteStatus: result.legacy.is_quote_status,
            mediaCount: media.length,
            author,
            statistics,
            media,
        },
        cookie4SensitiveContent: cookie,
    };
};
