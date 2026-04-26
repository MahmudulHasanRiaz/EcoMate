import { getPaginationParams } from '../src/lib/pagination';

console.log('--- Pagination Verification ---');

function verify(name: string, input: any, expected: any) {
    const output = getPaginationParams(input);
    const matches = JSON.stringify(output) === JSON.stringify(expected);
    console.log(`${name}: ${matches ? 'PASS' : 'FAIL'}`);
    if (!matches) {
        console.log('  Input:', JSON.stringify(input));
        console.log('  Expected:', JSON.stringify(expected));
        console.log('  Actual:', JSON.stringify(output));
        process.exit(1);
    }
}

// Case 1: High pageSize
verify(
    'High pageSize clamping',
    { pageSize: '169', cursor: 'CUR123' },
    { page: 1, pageSize: 100, cursor: 'CUR123' }
);

// Case 2: Standard valid params
verify(
    'Standard params',
    { page: '2', pageSize: '50' },
    { page: 2, pageSize: 50, cursor: undefined }
);

// Case 3: Invalid pageSize (negative)
verify(
    'Negative pageSize',
    { pageSize: '-10' },
    { page: 1, pageSize: 20, cursor: undefined }
);

// Case 4: Invalid page
verify(
    'Invalid page string',
    { page: 'abc' },
    { page: 1, pageSize: 20, cursor: undefined }
);

console.log('All pagination tests passed.');
