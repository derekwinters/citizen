const { Router } = require('express');
const multiparty = require('multiparty');
const semverSort = require('semver-sort');
const logger = require('../lib/logger');
const { parseHcl } = require('../lib/util');
const { saveModule, hasModule } = require('../lib/storage');
const { save, getVersions, findOne } = require('../lib/modules-store');

const router = Router();

// register a module with version
router.post('/:namespace/:name/:provider/:version', (req, res, next) => {
  const {
    namespace,
    name,
    provider,
    version,
  } = req.params;
  const destPath = `${namespace}/${name}/${provider}/${version}`;
  let tarball;
  let filename;
  let owner = '';
  let source = '';

  const form = new multiparty.Form();

  form.on('error', (err) => {
    logger.error(`Error parsing form: ${err.stack}`);
    next(err);
  });

  form.on('part', async (part) => {
    part.on('error', (err) => {
      logger.error(`Error parsing form: ${err.stack}`);
      next(err);
    });

    const ownerBuf = [];
    const sourceBuf = [];
    const file = [];
    part.on('data', (buffer) => {
      if (!part.filename && part.name === 'owner') {
        ownerBuf.push(buffer);
      }
      if (!part.filename && part.name === 'source') {
        sourceBuf.push(buffer);
      }
      if (part.filename) {
        file.push(buffer);
      }
    });
    part.on('end', async () => {
      if (!part.filename && part.name === 'owner') {
        owner = Buffer.concat(ownerBuf).toString();
      }
      if (!part.filename && part.name === 'source') {
        source = Buffer.concat(sourceBuf).toString();
      }
      if (part.filename) {
        ({ filename } = part);
        tarball = Buffer.concat(file);
      }
    });
  });

  form.on('close', async () => {
    try {
      const exist = await hasModule(`${destPath}/${filename}`);
      if (exist) {
        const error = new Error('Module exist');
        error.status = 409;
        error.message = `${destPath} is already exist.`;
        return next(error);
      }

      const fileResult = await saveModule(`${destPath}/${filename}`, tarball);
      const definition = await parseHcl(name, tarball);
      const metaResult = await save({
        namespace,
        name,
        provider,
        version,
        owner,
        source,
        location: `${destPath}/${filename}`,
        definition,
      });

      if (fileResult && metaResult) {
        return res.status(201).render('modules/register', {
          id: destPath,
          owner,
          source,
          namespace,
          name,
          provider,
          version,
          published_at: new Date(),
        });
      }

      return next(new Error());
    } catch (e) {
      logger.error(e);
      return next(e);
    }
  });

  form.parse(req);
});

// https://www.terraform.io/docs/registry/api.html#get-a-specific-module
router.get('/:namespace/:name/:provider/:version', async (req, res, next) => {
  const options = { ...req.params };

  const module = await findOne(options);

  if (!module) {
    return next();
  }

  return res.render('modules/module', module);
});

// https://www.terraform.io/docs/registry/api.html#latest-version-for-a-specific-module-provider
router.get('/:namespace/:name/:provider', async (req, res, next) => {
  const options = { ...req.params };

  try {
    const versions = await getVersions(options);
    let versionList = versions.map(function(release) { return release.version});
    let sortedVersions = semverSort.asc(versionList);
    let latestVersion = sortedVersions.pop();
    console.log(sortedVersions);

    const module = await findOne({
      namespace: req.params.namespace,
      name: req.params.name,
      provider: req.params.provider,
      version: latestVersion
    });

    return res.render('modules/module', module);

  } catch (e) {
    next(e);
  }

});

module.exports = router;
