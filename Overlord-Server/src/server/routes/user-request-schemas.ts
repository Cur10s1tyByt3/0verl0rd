import {
  array,
  boolean,
  minLength,
  object,
  optional,
  partialCheck,
  picklist,
  pipe,
  record,
  string,
} from "valibot";

const nonEmptyString = pipe(string(), minLength(1, "Must not be empty"));

export const createUserBodySchema = object({
  username: nonEmptyString,
  password: nonEmptyString,
  role: picklist(["admin", "operator", "viewer"], "Invalid role"),
  mustChangePassword: optional(boolean()),
});

export const updatePasswordBodySchema = pipe(
  object({
    password: optional(nonEmptyString),
    newPassword: optional(nonEmptyString),
    currentPassword: optional(string()),
  }),
  partialCheck(
    [["password"], ["newPassword"]],
    (input) => Boolean(input.password || input.newPassword),
    "Password required",
  ),
);

export const updateRoleBodySchema = object({
  role: picklist(["admin", "operator", "viewer"], "Invalid role"),
});

export const updateClientAccessBodySchema = object({
  scope: picklist(["all", "allowlist", "denylist", "none"], "Invalid client access scope"),
});

export const clientAccessRuleBodySchema = object({
  clientId: nonEmptyString,
  access: picklist(["allow", "deny"], "Invalid client access rule"),
});

export const updateCanBuildBodySchema = object({ canBuild: boolean() });
export const updateCanUploadFilesBodySchema = object({ canUploadFiles: boolean() });

export const updateFeaturePermissionsBodySchema = object({
  permissions: record(string(), boolean()),
});

export const updatePluginAccessBodySchema = object({
  scope: picklist(["all", "allowlist", "none"], "Invalid plugin access scope"),
  pluginIds: optional(array(nonEmptyString)),
});
