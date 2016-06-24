/**
 * @copyright 2015, Prometheus Research, LLC
 */

import memoize from 'memoize-decorator';
import selectValue  from 'lodash/get';
import noop from 'lodash/noop';
import makeKeyPath from './keyPath';
import {update} from './update';
import * as Schema from './Schema';

let suppressUpdateContextual = false;

/**
 * Suppress any onChange notifications during the execution of the callback.
 */
export function suppressUpdate(tx) {
  suppressUpdateContextual = true;
  try {
    return tx();
  } finally {
    suppressUpdateContextual = false;
  }
}

function filterErrorListByKeyPath(errorList, keyPath) {
  let field = ['data'].concat(keyPath).join('.');
  return errorList.filter(error => error.field === field);
}

function filterErrorListByKeyPathPrefix(errorList, keyPath) {
  if (keyPath.length === 0) {
    return errorList;
  }
  let field = ['data'].concat(keyPath).join('.');
  let length = field.length;
  return errorList.filter(error =>
    error.field === field ||
    error.field.slice(0, length) === field && error.field[length] === '.'
  );
}

export class Value {

  select(key) {
    let keyPath = makeKeyPath(key);
    if (keyPath.length === 0) {
      return this;
    } else {
      return new ValueBranch(this.root, this.keyPath.concat(keyPath));
    }
  }

  @memoize
  get errorList() {
    let validateErrorList = filterErrorListByKeyPath(
      this.root._errorList, this.keyPath);
    let externalErrorList = filterErrorListByKeyPath(
      this.root._externalErrorList, this.keyPath);
    return validateErrorList.concat(externalErrorList);
  }

  @memoize
  get completeErrorList() {
    let validateErrorList = filterErrorListByKeyPathPrefix(
      this.root._errorList, this.keyPath);
    let externalErrorList = filterErrorListByKeyPathPrefix(
      this.root._externalErrorList, this.keyPath);
    return validateErrorList.concat(externalErrorList);
  }

  createRoot(update) {
    let values = {
      schema: this.root.schema,
      value: this.root.value,
      onChange: this.root.onChange,
      params: this.root.params,
      errorList: this.root._errorList,
      externalErrorList: this.root._externalErrorList,
    };
    return new ValueRoot({...values, ...update});
  }

  updateParams(params, suppressUpdate) {
    params = {...this.root.params, ...params};
    let nextRoot = this.createRoot({params});
    if (!suppressUpdate && !suppressUpdateContextual) {
      this.root.onChange(nextRoot, this.keyPath);
    }
    return nextRoot.select(this.keyPath);
  }

  update(valueUpdate, suppressUpdate) {
    let value;
    if (this.keyPath.length === 0) {
      value = valueUpdate;
    } else {
      value = update(this.root.value, this.keyPath, valueUpdate, this.root.schema);
    }
    let errorList = Schema.validate(this.root.schema, value);
    let nextRoot = this.createRoot({value, errorList});
    if (!suppressUpdate && !suppressUpdateContextual) {
      this.root.onChange(nextRoot, this.keyPath);
    }
    return nextRoot.select(this.keyPath);
  }

  updateError(error, suppressUpdate) {
    let field = ['data'].concat(this.keyPath).join('.');
    let externalErrorList;
    if (Array.isArray(error)) {
      externalErrorList = error.map(error => ({...error, field}));
    } else {
      externalErrorList = [{...error, field}];
    }

    let nextRoot = this.createRoot({externalErrorList});
    if (!suppressUpdate && !suppressUpdateContextual) {
      this.root.onChange(nextRoot, this.keyPath);
    }
    return nextRoot.select(this.keyPath);
  }

  addError(error, suppressUpdate) {
    error = {
      ...error,
      field: ['data'].concat(this.keyPath).join('.'),
    };
    let externalErrorList = this.root._externalErrorList.concat(error);
    let nextRoot = this.createRoot({externalErrorList});
    if (!suppressUpdate && !suppressUpdateContextual) {
      this.root.onChange(nextRoot, this.keyPath);
    }
    return nextRoot.select(this.keyPath);
  }

  removeError(error, suppressUpdate) {
    let idx = this.root._externalErrorList.indexOf(error);
    if (idx > -1) {
      let externalErrorList = this.root._externalErrorList.slice(0);
      externalErrorList.splice(idx, 1);
      let nextRoot = this.createRoot({externalErrorList});
      if (!suppressUpdate && !suppressUpdateContextual) {
        this.root.onChange(nextRoot, this.keyPath);
      }
      return nextRoot.select(this.keyPath);
    } else {
      return this;
    }
  }
}

class ValueRoot extends Value {

  constructor({schema, value, onChange, params, errorList, externalErrorList}) {
    super();
    this.parent = null;
    this.keyPath = [];
    this.schema = schema;
    this.value = value;
    this.onChange = onChange;
    this.params = params;
    this._errorList = errorList;
    this._externalErrorList = externalErrorList;
  }

  get root() {
    return this;
  }

  /**
   * Set schema.
   *
   * This method performs re-validation.
   */
  setSchema(schema) {
    let errorList = Schema.validate(schema, this.value);
    return this.createRoot({schema, errorList});
  }
}

class ValueBranch extends Value {

  constructor(root, keyPath) {
    super();
    this.root = root;
    this.keyPath = keyPath;
  }

  get params() {
    return this.root.params;
  }

  @memoize
  get schema() {
    return Schema.select(this.root.schema, this.keyPath);
  }

  @memoize
  get value() {
    return selectValue(this.root.value, this.keyPath);
  }

  get parent() {
    if (this.keyPath.length === 1) {
      return this.root;
    } else {
      let keyPath = this.keyPath.slice();
      keyPath.pop();
      return new ValueBranch(
        this.root,
        keyPath
      );
    }
  }

}

/**
 * Check if value is a form value.
 */
export function isValue(maybeValue) {
  return maybeValue instanceof Value;
}

/**
 * Create a new root value.
 */
export function createValue({
    schema,
    value = {},
    onChange = noop,
    params = {},
    errorList = null,
    externalErrorList = [],
  } = {}) {
  if (errorList === null) {
    errorList = Schema.validate(schema, value);
  }
  return new ValueRoot({schema, value, onChange, params, errorList, externalErrorList});
}
