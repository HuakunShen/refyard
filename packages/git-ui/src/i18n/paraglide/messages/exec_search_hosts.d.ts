/**
* | output |
* | --- |
* | "Search hosts by name, label or source" |
*
* @param {Exec_Search_HostsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const exec_search_hosts: ((inputs?: Exec_Search_HostsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Exec_Search_HostsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Exec_Search_HostsInputs = {};
