/**
* | output |
* | --- |
* | "Disconnect this account" |
*
* @param {Pr_Disconnect_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_disconnect_title: ((inputs?: Pr_Disconnect_TitleInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Pr_Disconnect_TitleInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Pr_Disconnect_TitleInputs = {};
