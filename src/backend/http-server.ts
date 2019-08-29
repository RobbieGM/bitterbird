import express from 'express';
import history from 'connect-history-api-fallback';
import path from 'path';
import userInfoAPI from './api-server-middleware';

const app = express();
const distDir = __dirname.split(path.sep).slice(0, -2).concat('dist').join(path.sep);
// const distDir = `C:\\Users\\Robbie\\Code\\bitterbird\\dist`;

const staticFileMiddleware = express.static(distDir);
app.use(userInfoAPI);
app.use(staticFileMiddleware);
app.use(history({
  verbose: true,
}));
app.use(staticFileMiddleware);

const port = process.argv[process.argv.length - 1] || 80;
app.listen(port, () => {
  console.log(`Example app listening on port ${port} serving ${distDir}`);
});