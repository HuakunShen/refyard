/**
* | output |
* | --- |
* | "Reading remotes…" |
*
* @param {Loading_RemotesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_remotes: ((inputs?: Loading_RemotesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Loading_RemotesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Loading_RemotesInputs = {};
