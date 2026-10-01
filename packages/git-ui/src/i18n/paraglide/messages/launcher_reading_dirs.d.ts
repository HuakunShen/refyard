/**
* | output |
* | --- |
* | "Reading directories…" |
*
* @param {Launcher_Reading_DirsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_reading_dirs: ((inputs?: Launcher_Reading_DirsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_Reading_DirsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_Reading_DirsInputs = {};
