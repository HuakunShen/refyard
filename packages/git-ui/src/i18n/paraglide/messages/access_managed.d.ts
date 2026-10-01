/**
* | output |
* | --- |
* | "Managed repositories" |
*
* @param {Access_ManagedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const access_managed: ((inputs?: Access_ManagedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Access_ManagedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Access_ManagedInputs = {};
