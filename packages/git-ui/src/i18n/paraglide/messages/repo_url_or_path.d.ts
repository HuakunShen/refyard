/**
* | output |
* | --- |
* | "https://host/project.git or an approved local path" |
*
* @param {Repo_Url_Or_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const repo_url_or_path: ((inputs?: Repo_Url_Or_PathInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Repo_Url_Or_PathInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Repo_Url_Or_PathInputs = {};
