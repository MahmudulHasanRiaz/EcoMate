import { renderPreFormattedPage, preFormattedPageMetadata } from "@/lib/templates/render-page";


export async function generateMetadata() {
  return preFormattedPageMetadata("company");
}

export default async function CompanyPage() {
  return renderPreFormattedPage("company");
}
