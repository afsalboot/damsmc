import { connectDb } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ok, apiError } from "@/lib/api";
import {Consultation,Expense,Purchase,Sale,Settings} from "@/models";
import { buildAccountLedger, LEDGER_SALE_FIELDS, LEDGER_EXPENSE_FIELDS, LEDGER_CONSULTATION_FIELDS } from "@/services/accounting.service";
import {queryValues} from "@/lib/filter-utils";

export async function GET(request){
  try{
    await requireSession("accounts");
    await connectDb();
    const parameters=new URL(request.url).searchParams;
    const [sales,expenses,purchases,settings,consultations]=await Promise.all([
      Sale.find().select(LEDGER_SALE_FIELDS).populate("actorId","name role").sort({createdAt:1}).lean(),
      Expense.find().select(LEDGER_EXPENSE_FIELDS).populate("actorId","name role").populate("staffId","name email role").sort({expenseDate:1}).lean(),
      Purchase.find().select("purchaseNumber supplierSnapshot supplierInvoiceNumber total amountPaid balanceDue paymentReference").lean(),
      Settings.findOne({key:"global"}).select("payments").lean(),
      Consultation.find().select(LEDGER_CONSULTATION_FIELDS).lean(),
    ]);
    const optionNames=["search","direction","transactionType","paymentMethod","source","dateFrom","dateTo","sort","order","page","limit"];
    const multiValueNames=new Set(["transactionType","paymentMethod","source"]);
    const options=Object.fromEntries(optionNames.map((name)=>[name,multiValueNames.has(name)?queryValues(parameters,name):parameters.get(name)||""]));
    options.purchases=purchases;
    options.consultations=consultations;
    options.enabledMethods=settings?.payments?.enabledMethods?.length?settings.payments.enabledMethods:["CASH","UPI","BANK"];
    return ok(buildAccountLedger(sales,expenses,options));
  }catch(error){return apiError(error);}
}
