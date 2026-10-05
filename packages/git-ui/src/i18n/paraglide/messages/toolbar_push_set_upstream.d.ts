/**
* | output |
* | --- |
* | "Choose where this branch pushes" |
*
* @param {Toolbar_Push_Set_UpstreamInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_push_set_upstream: ((inputs?: Toolbar_Push_Set_UpstreamInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Toolbar_Push_Set_UpstreamInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Toolbar_Push_Set_UpstreamInputs = {};
