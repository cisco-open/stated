/**
 * Performs a fetch request and enhances error handling.
 * If the response is not ok, it rejects with a custom error object that includes a `.json()` method.
 * This `.json()` method, when called, returns the error object itself, facilitating error handling
 * for scenarios where the caller expects to call `.json()` on the response.
 *
 * @param {string} url - The URL to fetch.
 * @param {Object} [opts] - Optional fetch options.
 * @returns {Promise<Response>} A promise that resolves to the fetch response. If the response is not ok,
 * it rejects with a custom error object consistent with Stated template-level error handling e.g. {error:{message:"..."}}.
 * @throws {Object} The custom error object with a `.json()` method if the response is not ok. The error
 * object structure is: { error: { message: string } }.
 *
 */
export const saferFetch = async (url, opts) => {
    const response = await fetch(url, opts);
    if (!response.ok) {
        console.error(`HTTP response not OK for '${url}', status: ${response.status}, statusText: ${response.statusText}`);
    }
    return response;
};