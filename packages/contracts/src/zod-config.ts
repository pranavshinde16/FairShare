import { z } from 'zod';

// Imported first by index.ts, so it runs before any schema is built. zod 4 compiles object
// schemas with `new Function` when it can, and finds out by trying, once, as the first object
// schema is built. In the browser, under the CSP (script-src 'self', no 'unsafe-eval'), that try is
// reported as a CSP violation even though zod catches it. jitless skips the try and the compiling,
// everywhere these schemas are used: parsing is a little slower, and the CSP is never touched.
//
// This file is why package.json has no "sideEffects": false: with it, the bundler (Rolldown) drops
// this import, and listing the file in a sideEffects array isn't honoured. The e2e tests fail on
// any CSP violation, so losing this again is caught.
z.config({ jitless: true });
