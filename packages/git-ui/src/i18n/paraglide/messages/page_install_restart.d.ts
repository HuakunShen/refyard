/**
* | output |
* | --- |
* | "Install and restart" |
*
* @param {Page_Install_RestartInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const page_install_restart: ((inputs?: Page_Install_RestartInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Page_Install_RestartInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Page_Install_RestartInputs = {};
