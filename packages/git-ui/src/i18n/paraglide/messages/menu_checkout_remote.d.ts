/**
* | output |
* | --- |
* | "Checkout {remote}/{branch} as Local Branch" |
*
* @param {Menu_Checkout_RemoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_checkout_remote: ((inputs: Menu_Checkout_RemoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Menu_Checkout_RemoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Menu_Checkout_RemoteInputs = {
    remote: NonNullable<unknown>;
    branch: NonNullable<unknown>;
};
