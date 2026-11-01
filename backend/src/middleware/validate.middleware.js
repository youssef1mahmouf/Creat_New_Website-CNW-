/** express-validator wrapper: runs chains and converts errors to ApiError. */
const { validationResult } = require('express-validator');
const ApiError = require('../utils/api-error');

function validate(chains) {
  return [
    ...chains,
    (req, _res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return next(
          ApiError.badRequest(
            'Validation failed',
            errors.array().map((e) => ({ field: e.path, message: e.msg }))
          )
        );
      }
      next();
    },
  ];
}

module.exports = { validate };
