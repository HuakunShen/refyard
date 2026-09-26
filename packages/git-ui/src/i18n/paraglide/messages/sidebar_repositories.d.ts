/**
* | output |
* | --- |
* | "Repositories" |
*
* @param {Sidebar_RepositoriesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_repositories: ((inputs?: Sidebar_RepositoriesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sidebar_RepositoriesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sidebar_RepositoriesInputs = {};
