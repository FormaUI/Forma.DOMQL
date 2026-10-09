try {
    Domql.read(Domql.parse('@panel.attribute-of 200', { panel }));
} catch (error) {
    if (error?.name !== 'DomqlError') {
        throw error;
    }

    console.error(error.kind, error.message, error.location);
    // validation
    // The argument 'name' of 'attribute-of' expects string and finds number
    // (line 1, column 21, at /query/arguments/0/value)
}
