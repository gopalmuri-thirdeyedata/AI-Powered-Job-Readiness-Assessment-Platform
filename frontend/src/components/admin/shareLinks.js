// Shared-link expiry presentation. The SERVER decides whether a link is expired (share_link_state, evaluated on the server
// clock for every response); the browser clock is deliberately never consulted here.
const hasLink = (role) => role.status === 'PUBLISHED' || role.status === 'CLOSED';

export const isLinkExpired = (role) => role.share_link_state === 'EXPIRED';

/** Published and not expired: the link can be copied and used right now. */
export const isLinkLive = (role) => role.status === 'PUBLISHED' && !isLinkExpired(role);

/** Rows of the Shared Links list: live links plus manually closed ones (reopenable); expired links are hidden. */
export const activeLinkRoles = (roles) => roles.filter((r) => hasLink(r) && !isLinkExpired(r));

export const expiredLinkRoles = (roles) => roles.filter((r) => hasLink(r) && isLinkExpired(r));

export const expiryNote = (role, format) => {
    if (!role.share_link_expires_at) return 'No expiry (created before link expiry was introduced). Close and reopen it to give it a 24-hour window.';
    return `${role.status === 'CLOSED' ? 'Reopening keeps the original expiry: ' : 'Expires '}${format(role.share_link_expires_at)}`;
};
