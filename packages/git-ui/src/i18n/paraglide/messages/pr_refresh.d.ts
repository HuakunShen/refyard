/**
* | output |
* | --- |
* | "Refresh pull requests" |
*
* @param {Pr_RefreshInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_refresh: ((inputs?: Pr_RefreshInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pr_RefreshInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pr_RefreshInputs = {};
