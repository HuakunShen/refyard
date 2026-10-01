/**
* | output |
* | --- |
* | "remote URL" |
*
* @param {Repo_Remote_UrlInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_remote_url: ((inputs?: Repo_Remote_UrlInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Remote_UrlInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Remote_UrlInputs = {};
