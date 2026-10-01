/**
* | output |
* | --- |
* | "Reading tags…" |
*
* @param {Loading_TagsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_tags: ((inputs?: Loading_TagsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Loading_TagsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Loading_TagsInputs = {};
