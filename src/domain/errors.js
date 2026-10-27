'use strict';

/** Expected business failures. The HTTP layer maps each class to a status code and error code. */
class DomainError extends Error {
  constructor(message, details) {
    super(message);
    this.name = this.constructor.name;
    if (details !== undefined) this.details = details;
  }
}
class ValidationError extends DomainError {}
class NotFoundError extends DomainError {}
class ConflictError extends DomainError {}
class ForbiddenError extends DomainError {}

module.exports = { DomainError, ValidationError, NotFoundError, ConflictError, ForbiddenError };
