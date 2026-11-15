import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";


export async function generateMetadata() {
  return preFormattedPageMetadata("refund-policy");
}

export default async function RefundPolicyPage() {
  return renderPreFormattedPage("refund-policy");
}
