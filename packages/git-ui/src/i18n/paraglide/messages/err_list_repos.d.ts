/**
* | output |
* | --- |
* | "Could not list repositories" |
*
* @param {Err_List_ReposInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_list_repos: ((inputs?: Err_List_ReposInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Err_List_ReposInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Err_List_ReposInputs = {};
