import type { DashboardData } from "@/app/lib/dashboard-data";
import type { FintabloSnapshot } from "@/app/lib/fintablo";

type Balances = { account: number; wallet: number };

export function fintabloToDashboardData(snapshot: FintabloSnapshot): DashboardData {
  const cash = snapshot.transactions.map((transaction) => ({
    date: transaction.date,
    amount: transaction.amount,
    source: transaction.account,
    counterparty: transaction.partner,
    article: transaction.category,
    flow: transaction.group === "income" ? "Поступление" : transaction.group === "outcome" ? "Выбытие" : transaction.group,
  }));
  const balances = snapshot.accounts
    .filter((account) => !account.hideInTotal)
    .reduce((result, account) => {
      const name = `${account.name} ${account.type}`.toLowerCase();
      if (/кош|касс|налич/.test(name)) result.wallet += account.balance;
      else result.account += account.balance;
      return result;
    }, { account: 0, wallet: 0 } satisfies Balances);
  return {
    source: "fintablo",
    updatedAt: snapshot.updatedAt,
    cash,
    orders: [],
    debtor: {},
    creditor: {},
    balances: { ...balances, date: snapshot.balanceDate || snapshot.updatedAt.slice(0, 10) },
    fields: { cash: true, orders: false, balances: true },
  };
}
