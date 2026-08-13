export type SafeContact = {
  id: string;
  name: string;
  contactType: string | null;
  customerNumber: string | null;
  email: string | null;
  invoiceEmail: string | null;
  phoneNumber: string | null;
  cellPhoneNumber: string | null;
  company: { id: string | null; name: string | null } | null;
  responsible: { id: string | null; name: string | null } | null;
  tags: Array<{ id: string | null; name: string; color: string | null }>;
  isActive: boolean | null;
  importantInformation: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result || null;
}

function nameId(value: unknown) {
  const item = record(value);
  if (!item) return null;
  const id = text(item.id);
  const name = text(item.name ?? item.title);
  return id || name ? { id, name } : null;
}

export function toSafeContact(item: Record<string, unknown>): SafeContact {
  const id = text(item.id);
  if (!id) throw new Error("Blikk returned a contact without an id.");

  return {
    id,
    name: text(item.name) ?? "Unnamed contact",
    contactType: text(item.contactType)?.toLowerCase() ?? null,
    customerNumber: text(item.customerNumber),
    email: text(item.email),
    invoiceEmail: text(item.invoiceEmail),
    phoneNumber: text(item.phoneNumber),
    cellPhoneNumber: text(item.cellPhoneNumber),
    company: nameId(item.company),
    responsible: nameId(item.responsible),
    tags: Array.isArray(item.tags)
      ? item.tags.flatMap((value) => {
          const tag = record(value);
          if (!tag) return [];
          const name = text(tag.name ?? tag.title);
          if (!name) return [];
          return [{ id: text(tag.id), name, color: text(tag.color) }];
        })
      : [],
    isActive: typeof item.isActive === "boolean" ? item.isActive : null,
    importantInformation: text(item.importantInformation),
  };
}
