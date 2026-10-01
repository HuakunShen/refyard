/**
* | output |
* | --- |
* | "Name or email" |
*
* @param {Filters_Name_Or_EmailInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_name_or_email: ((inputs?: Filters_Name_Or_EmailInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Filters_Name_Or_EmailInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Filters_Name_Or_EmailInputs = {};
