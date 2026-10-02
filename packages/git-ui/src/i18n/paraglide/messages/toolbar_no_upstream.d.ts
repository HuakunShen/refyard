/**
* | output |
* | --- |
* | "No upstream configured for this branch" |
*
* @param {Toolbar_No_UpstreamInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_no_upstream: ((inputs?: Toolbar_No_UpstreamInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Toolbar_No_UpstreamInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Toolbar_No_UpstreamInputs = {};
