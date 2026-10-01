/**
* | output |
* | --- |
* | "No repository selected" |
*
* @param {History_No_RepositoryInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_no_repository: ((inputs?: History_No_RepositoryInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<History_No_RepositoryInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type History_No_RepositoryInputs = {};
