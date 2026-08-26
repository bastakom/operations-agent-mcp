import { getContact } from "./endpoints";
import {
  toSafeContact,
  type SafeContact,
} from "./contacts";

const REQUESTS_PER_BATCH = 3;
const REQUEST_DELAY_MS = 1100;

export type SalesCustomerReference = {
  customerId: string;
  customerName: string;
};

export type SalesCustomerContact = {
  customerId: string;
  customerName: string;
  customerNumber: string | null;
  responsible: SafeContact["responsible"];
  email: string | null;
  invoiceEmail: string | null;
  phoneNumber: string | null;
  cellPhoneNumber: string | null;
  isActive: boolean | null;
  importantInformation: string | null;
};

export type SalesCustomerContactFailure = {
  customerId: string;
  customerName: string;
  error: string;
};

function wait(milliseconds: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}

function toSalesCustomerContact(
  reference: SalesCustomerReference,
  contact: SafeContact
): SalesCustomerContact {
  return {
    customerId: reference.customerId,
    customerName: contact.name || reference.customerName,
    customerNumber: contact.customerNumber,
    responsible: contact.responsible,
    email: contact.email,
    invoiceEmail: contact.invoiceEmail,
    phoneNumber: contact.phoneNumber,
    cellPhoneNumber: contact.cellPhoneNumber,
    isActive: contact.isActive,
    importantInformation: contact.importantInformation,
  };
}

export async function resolveSalesCustomerContacts(
  customers: SalesCustomerReference[]
) {
  const contacts: Record<string, SalesCustomerContact> = {};
  const failures: SalesCustomerContactFailure[] = [];

  for (
    let index = 0;
    index < customers.length;
    index += REQUESTS_PER_BATCH
  ) {
    if (index > 0) {
      await wait(REQUEST_DELAY_MS);
    }

    const batch = customers.slice(
      index,
      index + REQUESTS_PER_BATCH
    );

    const results = await Promise.allSettled(
      batch.map(async (reference) => {
        const rawContact = await getContact(
          reference.customerId
        );
        const safeContact = toSafeContact(rawContact);

        return toSalesCustomerContact(
          reference,
          safeContact
        );
      })
    );

    results.forEach((result, resultIndex) => {
      const reference = batch[resultIndex];

      if (result.status === "fulfilled") {
        contacts[reference.customerId] = result.value;
        return;
      }

      failures.push({
        customerId: reference.customerId,
        customerName: reference.customerName,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    });
  }

  return {
    contacts,
    failures,
  };
}
