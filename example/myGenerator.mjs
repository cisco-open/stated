export async function* myGenerator() {
    for (let i = 1; i < 10; i++) {
        yield i;
    }
    return 10; // Last value with `done: true`
}