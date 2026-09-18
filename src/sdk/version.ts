/**
 * The SDK's version.
 *
 * Sent with every request as `X-Talqyn-SDK`, so that a report of "search broke on the site" can be
 * narrowed to the builds it actually broke in. Quote it when contacting Talqyn support. A test
 * keeps it equal to the version in `package.json`.
 */
export const TALQYN_VERSION = '1.0.0';

/**
 * The value of the `X-Talqyn-SDK` header: platform and version.
 *
 * Public for a storefront that mints device tokens through a transport of its own — the header
 * identifies the client on those requests too.
 */
export const TALQYN_CLIENT_HEADER = `web/${TALQYN_VERSION}`;
