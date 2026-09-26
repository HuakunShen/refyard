/**
* | output |
* | --- |
* | "Tags" |
*
* @param {Sidebar_TagsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_tags: ((inputs?: Sidebar_TagsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sidebar_TagsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sidebar_TagsInputs = {};
