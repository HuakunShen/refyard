/**
* | output |
* | --- |
* | "What remote/branch should \"{branch}\" push to and pull from?" |
*
* @param {Push_Upstream_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_title: ((inputs: Push_Upstream_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Push_Upstream_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Push_Upstream_TitleInputs = {
    branch: NonNullable<unknown>;
};
