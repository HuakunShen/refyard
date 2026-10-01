/**
* | output |
* | --- |
* | "Revoke" |
*
* @param {Access_RevokeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const access_revoke: ((inputs?: Access_RevokeInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Access_RevokeInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Access_RevokeInputs = {};
