import mongoose, { type Model, type Schema } from "mongoose";

/**
 * Registers a Mongoose model.
 *
 * Mongoose keeps compiled models in a process-wide registry, and `next dev` keeps the
 * process alive across code changes. Reusing `models[name]` there means a running dev
 * server keeps validating with the OLD schema after the schema file changes (e.g. still
 * requiring exactly 4 options), which surfaces as confusing 500s. Outside production we
 * therefore drop the cached model and recompile it from the current schema.
 */
export function defineModel<T>(name: string, schema: Schema<T>): Model<T> {
  if (process.env.NODE_ENV !== "production" && mongoose.models[name]) {
    mongoose.deleteModel(name);
  }
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
}
