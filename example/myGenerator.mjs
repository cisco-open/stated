export async function* myGenerator() {
    for (let i = 1; i <= 10; i++) {
        yield i;
    }
}