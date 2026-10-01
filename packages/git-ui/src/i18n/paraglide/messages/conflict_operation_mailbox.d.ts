/**
* | output |
* | --- |
* | "mailbox apply" |
*
* @param {Conflict_Operation_MailboxInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_mailbox: ((inputs?: Conflict_Operation_MailboxInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Operation_MailboxInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Operation_MailboxInputs = {};
