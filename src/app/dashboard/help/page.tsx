'use client';

import { useState } from 'react';
import { 
  BookOpen, 
  Settings, 
  ShoppingCart, 
  Package, 
  Users, 
  Truck, 
  BarChart3, 
  Building2,
  Store,
  Download,
  Database,
  Key,
  Warehouse,
  ClipboardList,
  Wallet,
  UserCheck,
  Megaphone,
  Mail,
  MessageSquare,
  Shield,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Info,
  ChevronRight,
  Globe
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

type SectionId = 
  | 'setup' | 'courier' | 'orders' | 'packing' | 'inventory' 
  | 'customers' | 'delivery' | 'finance' | 'staff' | 'wholesale' 
  | 'integrations' | 'marketing' | 'reporting' | 'other-settings' | 'api';

const sections: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: 'setup', label: 'প্রি-রিকোয়ারিমেন্ট ও সেটআপ', icon: Settings },
  { id: 'courier', label: 'কুরিয়ার ইন্টিগ্রেশন', icon: Truck },
  { id: 'orders', label: 'অর্ডার ম্যানেজমেন্ট', icon: ShoppingCart },
  { id: 'packing', label: 'প্যাকিং ও ফুলফিলমেন্ট', icon: Package },
  { id: 'inventory', label: 'ইনভেন্টরি ও প্রোডাক্ট', icon: Warehouse },
  { id: 'customers', label: 'কাস্টমার সার্ভিস', icon: Users },
  { id: 'delivery', label: 'কুরিয়ার ও ডেলিভারি', icon: Truck },
  { id: 'finance', label: 'ফাইন্যান্স ও অ্যাকাউন্টিং', icon: Wallet },
  { id: 'staff', label: 'স্টাফ ও HR', icon: UserCheck },
  { id: 'wholesale', label: 'হোলসেল ম্যানেজমেন্ট', icon: Building2 },
  { id: 'integrations', label: 'ইন্টিগ্রেশন', icon: Store },
  { id: 'marketing', label: 'মার্কেটিং', icon: Megaphone },
  { id: 'reporting', label: 'রিপোর্টিং ও অ্যানালিটিক্স', icon: BarChart3 },
  { id: 'other-settings', label: 'অন্যান্য সেটিংস', icon: Shield },
  { id: 'api', label: 'API ডকুমেন্টেশন', icon: Key },
];

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState<SectionId>('setup');

  return (
    <div className="container mx-auto px-4 py-4 md:py-8 max-w-6xl font-bengali">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6 md:mb-8">
        <div className="p-2 md:p-3 bg-primary/10 rounded-lg">
          <BookOpen className="h-6 w-6 md:h-8 md:h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">হেল্প সেন্টার</h1>
          <p className="text-sm md:text-base text-muted-foreground">EcoMate ব্যবহারের সম্পূর্ণ গাইড</p>
        </div>
      </div>

      {/* Mobile Navigation - Horizontal Scrollable Chips */}
      <div className="lg:hidden flex overflow-x-auto gap-2 pb-4 mb-2 -mx-4 px-4 scrollbar-hide no-scrollbar">
        {sections.map((section) => (
          <Button
            key={section.id}
            variant={activeSection === section.id ? 'default' : 'outline'}
            size="sm"
            className="shrink-0 rounded-full h-9"
            onClick={() => {
              setActiveSection(section.id);
              // Scroll content area into view on mobile
              document.getElementById('help-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            <section.icon className="mr-2 h-4 w-4" />
            {section.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="hidden lg:block lg:col-span-1">
          <Card className="sticky top-8">
            <CardHeader className="p-4">
              <CardTitle className="text-lg">বিষয়বস্তু</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-1 max-h-[70vh] overflow-y-auto">
              {sections.map((section) => (
                <Button
                  key={section.id}
                  variant={activeSection === section.id ? 'default' : 'ghost'}
                  className="w-full justify-start text-left text-sm h-auto py-2"
                  onClick={() => setActiveSection(section.id)}
                >
                  <section.icon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{section.label}</span>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div id="help-content" className="lg:col-span-3 space-y-6">
          {activeSection === 'setup' && <SetupSection />}
          {activeSection === 'courier' && <CourierSection />}
          {activeSection === 'orders' && <OrdersSection />}
          {activeSection === 'packing' && <PackingSection />}
          {activeSection === 'inventory' && <InventorySection />}
          {activeSection === 'customers' && <CustomersSection />}
          {activeSection === 'delivery' && <DeliverySection />}
          {activeSection === 'finance' && <FinanceSection />}
          {activeSection === 'staff' && <StaffSection />}
          {activeSection === 'wholesale' && <WholesaleSection />}
          {activeSection === 'integrations' && <IntegrationsSection />}
          {activeSection === 'marketing' && <MarketingSection />}
          {activeSection === 'reporting' && <ReportingSection />}
          {activeSection === 'other-settings' && <OtherSettingsSection />}
          {activeSection === 'api' && <APISection />}
        </div>
      </div>
    </div>
  );
}

function Prereq({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 rounded-lg text-sm">
      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
      <div>প্রি-রিকোয়ারিমেন্ট: {children}</div>
    </div>
  );
}

function Consequence({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3 rounded-lg text-sm">
      <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
      <div>না করলে: {children}</div>
    </div>
  );
}

function Step({ num, children }: { num: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{num}</span>
      <div>{children}</div>
    </div>
  );
}

function PathLink({ path }: { path: string }) {
  return (
    <span className="inline-flex items-center text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
      {path}
    </span>
  );
}

function PathBadge({ path, label }: { path: string; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-medium">{label}:</span>
      <PathLink path={path} />
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  const IconComp = Icon;
  return (
    <Card className="border-none sm:border shadow-none sm:shadow-sm">
      <CardHeader className="px-4 py-4 md:px-6 md:py-6">
        <CardTitle className="flex items-center gap-2 text-xl">
          <IconComp className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-6 md:px-6 md:pb-6 space-y-4">
        {children}
      </CardContent>
    </Card>
  );
}

// ============================================================
// SECTION 1: PREREQUISITES & SETUP
// ============================================================
function SetupSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="প্রি-রিকোয়ারিমেন্ট ও বেসিক সেটআপ" icon={Settings}>
        <p className="text-sm text-muted-foreground">
          EcoMate সম্পূর্ণভাবে ব্যবহার শুরু করার আগে নিচের সেটআপগুলো করতে হবে। এগুলো ছাড়া অনেক ফিচার সঠিকভাবে কাজ করবে না।
        </p>

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="branches">
            <AccordionTrigger>শাখা (Branches)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Branches" />
                <p>শাখা হলো EcoMate-এর মূল সাংগঠনিক একক। প্রতিটি শাখার একটি নাম এবং কোড থাকে।</p>
                <Step num={1}>Settings {'>'} Branches এ যান</Step>
                <Step num={2}>"Add Branch" এ ক্লিক করুন</Step>
                <Step num={3}>শাখার নাম (যেমন: ঢাকা শোরুম) এবং কোড (যেমন: DHK-01) দিন</Step>
                <Step num={4}>Save করুন</Step>
                <Consequence>শাখা তৈরি না করলে Showroom তৈরি করতে পারবেন না এবং POS ব্যবহার করতে পারবেন না।</Consequence>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  শাখা শুধু একটি নাম ও কোড। এটি ইনভেন্টরি আলাদা করে না — ইনভেন্টরি Stock Location অনুযায়ী আলাদা হয়।
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="stock-locations">
            <AccordionTrigger>Stock Location (লোকেশন)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Locations" />
                <p>Stock Location হলো ইনভেন্টরি ট্র্যাকিংয়ের জায়গা। এখানে প্রোডাক্টের স্টক কোন লোকেশনে আছে তা ট্র্যাক করা হয়।</p>
                <Step num={1}>Settings {'>'} Locations এ যান</Step>
                <Step num={2}>"Add Location" এ ক্লিক করুন</Step>
                <Step num={3}>লোকেশনের নাম দিন (যেমন: ঢাকা গোডাউন, মিরপুর শোরুম)</Step>
                <Step num={4}>Save করুন</Step>
                <Consequence>Stock Location তৈরি না করলে: ইনভেন্টরি সঠিকভাবে ট্র্যাক করতে পারবেন না, স্টক ট্রান্সফার করতে পারবেন না, Showroom তৈরি করতে পারবেন না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="cash-drawers">
            <AccordionTrigger>Cash Drawer (ক্যাশ ড্রয়ার)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Cash Drawers" />
                <p>Cash Drawer হলো POS এ ক্যাশ ট্র্যাকিং এর জন্য। প্রতিটি Showroom-এ একটি Cash Drawer থাকে।</p>
                <Step num={1}>Settings {'>'} Cash Drawers এ যান</Step>
                <Step num={2}>"Add Cash Drawer" এ ক্লিক করুন</Step>
                <Step num={3}>ড্রয়ারের নাম দিন এবং Default কিনা চিহ্নিত করুন</Step>
                <Step num={4}>Save করুন</Step>
                <Consequence>Cash Drawer ছাড়া POS থেকে ক্যাশ পেমেন্ট ট্র্যাক করতে পারবেন না।</Consequence>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  Cash Drawer গ্লোবাল — এটি শাখা অনুযায়ী আলাদা নয়। Showroom তৈরির সময় একটি Cash Drawer অ্যাসাইন করতে হয়।
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="showrooms">
            <AccordionTrigger>Showroom (শোরুম)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Showrooms" />
                <p>Showroom হলো POS ব্যবহারের মূল একক। প্রতিটি Showroom একটি Stock Location এবং একটি Cash Drawer নিয়ে তৈরি হয়, এবং নির্দিষ্ট স্টাফদের অ্যাক্সেস দেওয়া যায়।</p>
                <Step num={1}>Settings {'>'} Showrooms এ যান</Step>
                <Step num={2}>"Add Showroom" এ ক্লিক করুন</Step>
                <Step num={3}>নাম, Stock Location, Cash Drawer সিলেক্ট করুন</Step>
                <Step num={4}>যেসব স্টাফ POS ব্যবহার করবেন তাদের সিলেক্ট করুন</Step>
                <Step num={5}>Save করুন</Step>
                <Prereq>Stock Location এবং Cash Drawer আগে তৈরি করতে হবে।</Prereq>
                <Consequence>Showroom ছাড়া POS ব্যবহার করতে পারবেন না। স্টাফ POS-এ ঢুকতে পারবে না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="categories">
            <AccordionTrigger>ক্যাটাগরি (Categories)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Categories" />
                <p>দুই ধরনের ক্যাটাগরি আছে: প্রোডাক্ট ক্যাটাগরি এবং খরচের ক্যাটাগরি।</p>
                <Step num={1}>Settings {'>'} Categories এ যান</Step>
                <Step num={2}>ট্যাব সিলেক্ট করুন: Product বা Expense</Step>
                <Step num={3}>"Add Category" এ ক্লিক করুন</Step>
                <Step num={4}>ক্যাটাগরির নাম দিন। প্যারেন্ট ক্যাটাগরি সিলেক্ট করলে সাব-ক্যাটাগরি তৈরি হবে।</Step>
                <Step num={5}>Save করুন</Step>
                <Consequence>প্রোডাক্ট ক্যাটাগরি ছাড়া প্রোডাক্ট তৈরি করতে পারবেন না। খরচের ক্যাটাগরি ছাড়া খরচ এন্ট্রি করতে পারবেন না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="brands">
            <AccordionTrigger>ব্র্যান্ড (Brands)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Brands" />
                <p>প্রোডাক্টের ব্র্যান্ড এন্ট্রি করুন।</p>
                <Step num={1}>Settings {'>'} Brands এ যান</Step>
                <Step num={2}>"Add Brand" এ ক্লিক করুন</Step>
                <Step num={3}>ব্র্যান্ডের নাম দিন</Step>
                <Step num={4}>Save করুন</Step>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="products">
            <AccordionTrigger>প্রোডাক্ট ইনপুট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Products {'>'} All Products" />
                <p>প্রোডাক্ট যোগ করার আগে ক্যাটাগরি এবং ব্র্যান্ড তৈরি করতে হবে।</p>
                <Step num={1}>Products {'>'} All Products এ যান</Step>
                <Step num={2}>"New Product" এ ক্লিক করুন (অথবা ডানদিকের "+" বাটন)</Step>
                <Step num={3}>প্রোডাক্টের নাম, ক্যাটাগরি, ব্র্যান্ড, প্রাইস দিন</Step>
                <Step num={4}>ভেরিয়েন্ট (রঙ, সাইজ ইত্যাদি) যোগ করুন</Step>
                <Step num={5}>ইমেজ আপলোড করুন</Step>
                <Step num={6}>Save করুন</Step>
                <Prereq>ক্যাটাগরি এবং ব্র্যান্ড আগে তৈরি করতে হবে।</Prereq>
                <Consequence>প্রোডাক্ট ছাড়া POS-এ বিক্রয় করতে পারবেন না, অর্ডার তৈরি করতে পারবেন না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="business">
            <AccordionTrigger>বিজনেস (Business)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Business" />
                <p>বিজনেস হলো পার্টনার/হোলসেল বা সাপ্লায়ারদের ব্যবসায়িক প্রোফাইল। ওয়েবসাইট ইন্টিগ্রেশনেও (WooCommerce, Laravel, Next.js) বিজনেস প্রয়োজন।</p>
                <Step num={1}>Settings {'>'} Business এ যান</Step>
                <Step num={2}>নতুন বিজনেস যোগ করুন</Step>
                <Step num={3}>বিজনেসের নাম, ফোন, ঠিকানা দিন</Step>
                <Step num={4}>Save করুন</Step>
                <Prereq>ওয়েবসাইট ইন্টিগ্রেশন করতে অন্তত একটি বিজনেস থাকতে হবে।</Prereq>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 2: COURIER INTEGRATION
// ============================================================
function CourierSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="কুরিয়ার ইন্টিগ্রেশন" icon={Truck}>
        <Consequence>কুরিয়ার ইন্টিগ্রেশন ছাড়া অর্ডার ডেলিভারি ট্র্যাকিং, COD ম্যানেজমেন্ট এবং স্বয়ংক্রিয় শিপিং করতে পারবেন না।</Consequence>

        <Accordion type="multiple" className="w-full">
          <AccordionItem value="steadfast">
            <AccordionTrigger>Steadfast কুরিয়ার সেটআপ</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Courier {'>'} Steadfast ট্যাব" />
                <p>Steadfast বাংলাদেশের অন্যতম জনপ্রিয় কুরিয়ার সার্ভিস।</p>
                <Step num={1}>Steadfast-এর ওয়েবসাইটে একাউন্ট তৈরি করুন এবং API Key ও Secret Key সংগ্রহ করুন</Step>
                <Step num={2}>Settings {'>'} Courier এ যান</Step>
                <Step num={3}>Steadfast ট্যাব সিলেক্ট করুন</Step>
                <Step num={4}>API Key এবং Secret Key দিন</Step>
                <Step num={5}>"Webhook Token" দিন (Steadfast থেকে ডেলিভারি স্ট্যাটাস পাওয়ার জন্য)</Step>
                <Step num={6}>Save করুন</Step>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  Steadfast-এর API Key পেতে তাদের মার্চেন্ট প্যানেলে লগইন করে Settings {'>'} API এ যান।
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="redx">
            <AccordionTrigger>RedX কুরিয়ার সেটআপ</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Courier {'>'} RedX ট্যাব" />
                <p>RedX কুরিয়ার সার্ভিসের জন্য শুধু API Access Token প্রয়োজন।</p>
                <Step num={1}>RedX মার্চেন্ট একাউন্টে API Access Token সংগ্রহ করুন</Step>
                <Step num={2}>Settings {'>'} Courier এ যান</Step>
                <Step num={3}>RedX ট্যাব সিলেক্ট করুন</Step>
                <Step num={4}>API Access Token দিন</Step>
                <Step num={5}>Save করুন</Step>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="carrybee">
            <AccordionTrigger>Carrybee কুরিয়ার সেটআপ</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Courier {'>'} Carrybee ট্যাব" />
                <p>Carrybee-এর জন্য বেশ কিছু ফিল্ড প্রয়োজন।</p>
                <Step num={1}>Carrybee একাউন্ট থেকে নিচের তথ্য সংগ্রহ করুন</Step>
                <Step num={2}>Settings {'>'} Courier এ যান</Step>
                <Step num={3}>Carrybee ট্যাব সিলেক্ট করুন</Step>
                <Step num={4}>নিচের ফিল্ডগুলো পূরণ করুন:</Step>
                <ul className="list-disc list-inside ml-6 space-y-1">
                  <li><strong>Base URL</strong> — যেমন: https://stage-sandbox.carrybee.com</li>
                  <li><strong>Client ID</strong> — Carrybee থেকে পাওয়া</li>
                  <li><strong>Client Secret</strong> — Carrybee থেকে পাওয়া</li>
                  <li><strong>Client Context</strong> — Carrybee থেকে পাওয়া</li>
                  <li><strong>Default Store ID</strong> — Carrybee স্টোর থেকে পাওয়া</li>
                  <li><strong>Delivery Type</strong> — 1 (Normal) বা 2 (Express)</li>
                  <li><strong>Product Type</strong> — 1 (Parcel), 2 (Book), 3 (Document)</li>
                  <li><strong>Default Weight (grams)</strong></li>
                </ul>
                <Step num={5}>Webhook সেটআপ (ঐচ্ছিক): Webhook Secret এবং Webhook Integration Header Value দিন</Step>
                <Step num={6}>Save করুন</Step>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="pathao">
            <AccordionTrigger>Pathao কুরিয়ার সেটআপ</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Courier {'>'} Pathao ট্যাব" />
                <p>Pathao কুরিয়ার সার্ভিসের জন্য API credentials প্রয়োজন।</p>
                <Step num={1}>Pathao মার্চেন্ট একাউন্ট থেকে API credentials সংগ্রহ করুন</Step>
                <Step num={2}>Settings {'>'} Courier এ যান, Pathao ট্যাব সিলেক্ট করুন</Step>
                <Step num={3}>প্রয়োজনীয় ফিল্ডগুলো পূরণ করুন</Step>
                <Step num={4}>Save করুন</Step>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="default-courier">
            <AccordionTrigger>ডিফল্ট কুরিয়ার সেটিং</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>একাধিক কুরিয়ার কনফিগার করা থাকলে অর্ডার প্লেস করার সময় কোন কুরিয়ার ব্যবহার হবে তা সিলেক্ট করা যায়। ডিফল্ট কুরিয়ার সিলেক্ট করা যায় কুরিয়ার সেটিংস পেজে।</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 3: ORDER MANAGEMENT
// ============================================================
function OrdersSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="অর্ডার ম্যানেজমেন্ট" icon={ShoppingCart}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="pos">
            <AccordionTrigger>POS (Point of Sale) ব্যবহার</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/pos" />
                <p>POS দিয়ে সরাসরি বিক্রয় করা যায়। এটি শোরুম ভিত্তিক কাজ করে।</p>
                <Prereq>Showroom তৈরি এবং স্টাফকে শোরুম অ্যাক্সেস দেওয়া হয়েছে থাকতে হবে। প্রোডাক্ট এবং ক্যাশ ড্রয়ার কনফিগার করা থাকতে হবে।</Prereq>
                <Step num={1}>POS পেজে যান</Step>
                <Step num={2}>নিজের Showroom সিলেক্ট করুন</Step>
                <Step num={3}>প্রোডাক্ট খুঁজুন বা বারকোড স্ক্যান করুন</Step>
                <Step num={4}>কার্টে আইটেম যোগ করুন</Step>
                <Step num={5}>কাস্টমার তথ্য দিন (ঐচ্ছিক)</Step>
                <Step num={6}>পেমেন্ট মেথড সিলেক্ট করুন (Cash/Card/Mobile Banking)</Step>
                <Step num={7}>অর্ডার Confirm করুন</Step>
                <Step num={8}>ইনভয়েস প্রিন্ট করুন</Step>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="order-list">
            <AccordionTrigger>অর্ডার লিস্ট ও ফিল্টার</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Orders {'>'} All Orders" />
                <p>সকল অর্ডার দেখুন এবং ফিল্টার করুন।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>স্ট্যাটাস অনুযায়ী ফিল্টার (Processing, Shipped, Delivered, Cancelled ইত্যাদি)</li>
                  <li>তারিখ অনুযায়ী ফিল্টার</li>
                  <li>কুরিয়ার অনুযায়ী ফিল্টার</li>
                  <li>অর্ডারের ডিটেইল দেখুন, এডিট করুন, স্ট্যাটাস পরিবর্তন করুন</li>
                  <li>অর্ডার প্রিন্ট করুন (ইনভয়েস, স্টিকার)</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="incomplete">
            <AccordionTrigger>অসম্পূর্ণ অর্ডার (Incomplete Leads)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Orders {'>'} Incomplete Orders" />
                <p>আপনার ইন্টিগ্রেটেড ওয়েবসাইট থেকে আসা অসম্পূর্ণ অর্ডার (পরিত্যক্ত চেকআউট, পেমেন্ট ব্যর্থ) ট্র্যাক করুন। যে কোনো ওয়েবসাইট ইন্টিগ্রেশনে (WooCommerce, Laravel, Next.js, Custom) Incomplete Order Capture চালু থাকলেই এই ফিচার কাজ করে।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>ফোন নম্বর বা ডোমেইন অনুযায়ী সার্চ করুন</li>
                  <li>Business এবং Assignee দিয়ে ফিল্টার করুন</li>
                  <li>লিডকে অর্ডারে Convert করুন</li>
                </ul>
                <Consequence>Incomplete Order Capture বন্ধ থাকলে এই লিডগুলো ট্র্যাক করা যাবে না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="scan">
            <AccordionTrigger>অর্ডার স্ক্যান</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Orders {'>'} Scan Orders" />
                <p>অর্ডার ID বা ট্র্যাকিং কোড দিয়ে দ্রুত অর্ডার খুঁজুন। বারকোড স্ক্যানারও ব্যবহার করা যায়।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="track">
            <AccordionTrigger>ট্র্যাক অর্ডার</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/track-order" />
                <p>কাস্টমাররা অর্ডার ট্র্যাক করতে পারেন এই পাবলিক পেজে। অর্ডার ID বা ফোন নম্বর দিয়ে সার্চ করুন।</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 4: PACKING & FULFILLMENT
// ============================================================
function PackingSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="প্যাকিং ও ফুলফিলমেন্ট" icon={Package}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="packing-process">
            <AccordionTrigger>প্যাকিং প্রসেস</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/packing-orders" />
                <p>প্যাকিং অর্ডার হলো সেই অর্ডারগুলো যেগুলো প্যাকেজিংয়ের জন্য অপেক্ষমাণ। প্যাকিং সম্পন্ন হলে অর্ডার কুরিয়ারে পাঠানোর জন্য প্রস্তুত হয়।</p>
                <Step num={1}>Packing Orders পেজে যান</Step>
                <Step num={2}>প্যাকেজ করতে চাইলে অর্ডারটি সিলেক্ট করুন</Step>
                <Step num={3}>প্যাকেজিং নিশ্চিত করুন</Step>
                <Step num={4}>ইনভয়েস/স্টিকার প্রিন্ট করুন</Step>
                <Step num={5}>কুরিয়ারে বুক করুন</Step>
                <Consequence>প্যাকিং ছাড়া অর্ডার কুরিয়ারে পাঠানো যাবে না সঠিকভাবে।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="print">
            <AccordionTrigger>ইনভয়েস ও স্টিকার প্রিন্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>ইনভয়েস:</strong> অর্ডারের বিস্তারিত প্রিন্ট (পথ: /print/invoice/[id])</li>
                  <li><strong>স্টিকার:</strong> প্যাকেজিং লেবেল প্রিন্ট (পথ: /print/sticker/[id])</li>
                  <li><strong>বাল্ক প্রিন্ট:</strong> একাধিক অর্ডারের ইনভয়েস একসাথে প্রিন্ট</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 5: INVENTORY & PRODUCTS
// ============================================================
function InventorySection() {
  return (
    <div className="space-y-6">
      <SectionCard title="ইনভেন্টরি ও প্রোডাক্ট" icon={Warehouse}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="stock-list">
            <AccordionTrigger>স্টক লিস্ট ও ম্যানেজমেন্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/inventory" />
                <p>ইনভেন্টরি পেজে সকল প্রোডাক্টের স্টক দেখা যায়, Stock Location অনুযায়ী।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>প্রোডাক্ট অনুযায়ী স্টক দেখুন</li>
                  <li>Location অনুযায়ী স্টক ফিল্টার করুন</li>
                  <li>স্টক Adjust করুন (বাড়ানো বা কমানো)</li>
                  <li>স্টক ট্রান্সফার করুন (এক Location থেকে অন্যটিতে)</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="low-stock">
            <AccordionTrigger>লো স্টক অ্যালার্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>General Settings-এ Low Stock Threshold সেট করা থাকলে, স্টক যখন সেই সংখ্যার নিচে নামে তখন অ্যালার্ট দেখায়।</p>
                <Consequence>Low Stock Threshold সেট না থাকলে লো স্টক অ্যালার্ট পাবেন না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="product-edit">
            <AccordionTrigger>প্রোডাক্ট এডিট ও ভেরিয়েন্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Products {'>'} All Products {'>'} [ক্লিক]" />
                <p>প্রোডাক্টে ক্লিক করলে ডিটেইল পেজে যাওয়া যায়। Edit বাটনে ক্লিক করে প্রোডাক্ট আপডেট করা যায়।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>প্রোডাক্টের নাম, বর্ণনা, প্রাইস এডিট করুন</li>
                  <li>ভেরিয়েন্ট (রঙ, সাইজ) যোগ/সরান</li>
                  <li>ইমেজ আপলোড করুন</li>
                  <li>ক্যাটাগরি ও ব্র্যান্ড পরিবর্তন করুন</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="reserved">
            <AccordionTrigger>Reserved Transfers</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/inventory/reserved-transfers" />
                <p>স্টক ট্রান্সফার যেগুলো রিজার্ভড অবস্থায় আছে সেগুলো এখানে দেখা যায়। হোলসেল অর্ডারের জন্য স্টক রিজার্ভ করা হলে এখানে দেখায়।</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 6: CUSTOMER SERVICE
// ============================================================
function CustomersSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="কাস্টমার সার্ভিস" icon={Users}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="customer-list">
            <AccordionTrigger>কাস্টমার লিস্ট ও প্রোফাইল</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/customers" />
                <p>সকল কাস্টমারের তালিকা দেখুন। কাস্টমারের ক্রয় ইতিহাস, অর্ডার ডিটেইল দেখা যায়।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>নাম, ফোন নম্বর দিয়ে সার্চ করুন</li>
                  <li>কাস্টমারের সম্পূর্ণ অর্ডার হিস্ট্রি দেখুন</li>
                  <li>কাস্টমার ডিটেইলে ক্লিক করে বিস্তারিত দেখুন</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 7: COURIER & DELIVERY
// ============================================================
function DeliverySection() {
  return (
    <div className="space-y-6">
      <SectionCard title="কুরিয়ার ও ডেলিভারি" icon={Truck}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="booking">
            <AccordionTrigger>কুরিয়ার বুকিং</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>অর্ডার প্যাকিং এর পর কুরিয়ারে বুকিং করা যায়।</p>
                <Step num={1}>অর্ডার ডিটেইল পেজে যান</Step>
                <Step num={2}>কুরিয়ার সিলেক্ট করুন (কনফিগার করা কুরিয়ার থেকে)</Step>
                <Step num={3}>ডেলিভারি তথ্য নিশ্চিত করুন</Step>
                <Step num={4}>বুকিং Confirm করুন</Step>
                <Prereq>কুরিয়ার ইন্টিগ্রেশন আগে কনফিগার করতে হবে।</Prereq>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="tracking">
            <AccordionTrigger>ডেলিভারি ট্র্যাকিং ও COD</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/courier" />
                <p>সকল কুরিয়ার শিপমেন্ট ট্র্যাকিং, COD ম্যানেজমেন্ট এবং ডেলিভারি রিপোর্ট।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>COD অ্যামাউন্ট দেখুন</li>
                  <li>ডেলিভারি চার্জ দেখুন</li>
                  <li>রিটার্ন প্রসেসিং ট্র্যাক করুন</li>
                  <li>কুরিয়ার-ভিত্তিক ডেলিভারি স্ট্যাটাস দেখুন</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="courier-report">
            <AccordionTrigger>কুরিয়ার রিপোর্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/courier-report" />
                <p>কুরিয়ার-ভিত্তিক পার্সেল পরিসংখ্যান — Total Parcels, Delivered, Canceled কাউন্ট ও ডেলিভারি/ক্যানসেল রেশিও।</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 8: FINANCE & ACCOUNTING
// ============================================================
function FinanceSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="ফাইন্যান্স ও অ্যাকাউন্টিং" icon={Wallet}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="accounting">
            <AccordionTrigger>অ্যাকাউন্টিং</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/accounting" />
                <p>Chart of Accounts, জার্নাল এন্ট্রি, জেনারেল লেজার এবং ব্যালেন্স শিট — সব এক জায়গায়।</p>

                <h4 className="font-semibold mt-2">তিনটি ট্যাব</h4>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Journal Entry:</strong> ম্যানুয়াল জার্নাল এন্ট্রি তৈরি ও পোস্ট করুন (একাউন্ট সিলেক্ট, ডেবিট/ক্রেডিট, ব্যালেন্স চেক)</li>
                  <li><strong>General Ledger:</strong> অ্যাকাউন্ট ফিল্টার, ডেট রেঞ্জ, রানিং ব্যালেন্স সহ লেজার ভিউ</li>
                  <li><strong>Balance Sheet:</strong> নির্দিষ্ট তারিখের সম্পূর্ণ ব্যালেন্স শিট — Assets ও Liabilities & Equity</li>
                </ul>
                <p className="mt-2">উপরে Account Monitor (Period Summary) কার্ডে প্রতি অ্যাকাউন্টের ডেবিট/ক্রেডিট/ব্যালেন্স সামারি দেখায়।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="cash-drawers">
            <AccordionTrigger>ক্যাশ ড্রয়ার ম্যানেজমেন্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/accounting/cash-drawers" />
                <p>প্রতিটি ক্যাশ ড্রয়ারের ব্যালেন্স এবং পূর্ণাঙ্গ ট্রানজেকশন হিস্টোরি।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Total System Cash:</strong> সব ড্রয়ারের সামগ্রিক ব্যালেন্স</li>
                  <li><strong>Transfer Funds:</strong> এক ড্রয়ার থেকে আরেক ড্রয়ারে ক্যাশ ট্রান্সফার</li>
                  <li><strong>Transaction History:</strong> প্রতি ড্রয়ারের ইন/আউটফ্লো টেবিল (তারিখ, টাইপ, বিবরণ, ডেবিট, ক্রেডিট, ব্যালেন্স), ডেট রেঞ্জ ফিল্টার, পেজিনেশন</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="expenses">
            <AccordionTrigger>খরচ (Expenses)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/expenses" />
                <p>খরচ এন্ট্রি তৈরি, এডিট, ডিলিট এবং অ্যাপ্রুভাল ম্যানেজমেন্ট।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>নতুন খরচ যোগ, এডিট, ডিলিট</li>
                  <li>ক্যাটাগরি, ব্রাঞ্চ, ডেট রেঞ্জ দিয়ে ফিল্টার</li>
                  <li><strong>Approve/Reject:</strong> Manager/Admin এপ্রুভ বা রিজেক্ট করতে পারে</li>
                  <li><strong>Mark as Paid:</strong> Admin/FinanceManager চেক নম্বর, চেক ডেট, স্ট্যাটাস সহ পেমেন্ট ট্র্যাক করতে পারে</li>
                  <li><strong>Ad Expense:</strong> বিজ্ঞাপন খরচ প্লাটফর্ম ও ক্যাম্পেইন অনুযায়ী ট্র্যাক</li>
                  <li>বাল্ক সিলেক্ট ও প্রিন্ট</li>
                </ul>
                <Consequence>খরচের ক্যাটাগরি তৈরি না করলে খরচ এন্ট্রি করতে পারবেন না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="check-passing">
            <AccordionTrigger>চেক পাসিং</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/check-passing" />
                <p>Purchase, Expense ও Staff — তিন সোর্স থেকে আসা চেকের পাসিং ট্র্যাকিং।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Overview Cards:</strong> Today, Tomorrow, 2/3/7 Days-এ কয়টা চেক পাস হবে</li>
                  <li>Passing Date, Reference, Payee, Type, Amount, Status কলাম সহ টেবিল</li>
                  <li>Source ফিল্টার (Purchase/Expense/Staff), Status ফিল্টার (Pending/Passed/Bounced/Cancelled)</li>
                  <li>সার্চ, ডেট রেঞ্জ, বাল্ক স্ট্যাটাস আপডেট</li>
                  <li><strong>View Voucher:</strong> সম্পূর্ণ পেমেন্ট ভাউচার ডিটেইল</li>
                  <li><strong>View History:</strong> স্ট্যাটাস চেঞ্জ লগ (ইউজার ও টাইমস্ট্যাম্প সহ)</li>
                  <li>CSV Export, সোর্স ডকুমেন্ট লিংক (PO, Expense)</li>
                </ul>

                <h4 className="font-semibold mt-2">চেক কিউ (Purchase)</h4>
                <PathBadge label="পথ" path="/dashboard/accounting/checks" />
                <p>Purchase পেমেন্ট চেকের জন্য আলাদা কিউ — Mark Passed, Bounce, Cancel অপশন সহ।</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 9: STAFF & HR
// ============================================================
function StaffSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="স্টাফ ও HR" icon={UserCheck}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="staff-list">
            <AccordionTrigger>স্টাফ ম্যানেজমেন্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/staff" />
                <p>সকল স্টাফ ম্যানেজ করুন। নতুন স্টাফ ইনভাইট করুন, রোল অ্যাসাইন করুন।</p>
                <Step num={1}>Staff {'>'} All Staff এ যান</Step>
                <Step num={2}>"Invite Staff" এ ক্লিক করুন</Step>
                <Step num={3}>নাম, ফোন, ইমেইল দিন</Step>
                <Step num={4}>রোল সিলেক্ট করুন (Admin, Manager, Call Assistant, Marketer সহ ১৭টি রোল)</Step>
                <Step num={5}>"Send Invitation Email" চেকবক্স চালু রাখলে ইমেইলে ইনভাইট পাঠাবে</Step>
                <Step num={6}>পারমিশন কাস্টমাইজ করুন — শুধু Custom রোলের জন্য (প্রি-ডিফাইন্ড রোলে লক থাকে)</Step>
                <Step num={7}>"Send Invitation" এ ক্লিক করুন</Step>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  রোল অনুযায়ী পারমিশন অটোমেটিক সেট হয়। শুধু Custom রোলে ম্যানুয়ালি সেট করতে হয়।
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="attendance">
            <AccordionTrigger>অ্যাটেনডেন্স</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/attendance" />
                <p>ডেইলি রোস্টার ভিউ — Today/Yesterday/Custom তারিখ দিয়ে স্টাফদের উপস্থিতি টেবিল।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>প্রত্যাশিত সময় বনাম প্রকৃত সময়, ওভারটাইম মিনিট, OT বোনাস</li>
                  <li>Status: Present, Late, Absent, Half-day</li>
                </ul>

                <h4 className="font-semibold mt-2">ক্লক ইন/আউট</h4>
                <p>Clock In/Out <strong>হেডারের ফ্লোটিং বাটন</strong> থেকে করতে হয় (সব পেজেই এক্সেসযোগ্য)। সেখানেই ব্রেক স্টার্ট/এন্ড ট্র্যাকিংও আছে।</p>

                <h4 className="font-semibold mt-2">অ্যাটেনডেন্স ক্যালেন্ডার</h4>
                <PathBadge label="পথ" path="/dashboard/attendance/calendar" />
                <p>মাসিক ক্যালেন্ডার ভিউতে সবার উপস্থিতি একনজরে।</p>

                <h4 className="font-semibold mt-2">শিফট</h4>
                <PathBadge label="পথ" path="Settings {'>'} Shifts" />
                <p>শিফট টেমপ্লেট তৈরি করুন — নাম, রোল, স্টার্ট/এন্ড টাইম, Late Grace, Early Leave Grace। <Consequence>শিফট তৈরি না করলে অ্যাটেনডেন্স সিস্টেম সঠিকভাবে কাজ করবে না।</Consequence></p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="leaves">
            <AccordionTrigger>লিভ ম্যানেজমেন্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p><strong>লিভ সাবমিট করার পাথ:</strong></p>
                <PathBadge label="পথ" path="/dashboard/account/leave" />
                <p>সব স্টাফ এখান থেকে "Request Leave" দিয়ে লিভ সাবমিট করে।</p>

                <p className="mt-2"><strong>লিভ অ্যাপ্রুভ/রিজেক্ট:</strong></p>
                <PathBadge label="পথ" path="/dashboard/attendance/leaves" />
                <p>Admin/Manager-এর জন্য। দুই ধাপের অ্যাপ্রুভাল প্রক্রিয়া: Pending → ManagerApproved → AdminApproved।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Pending স্ট্যাটাসে Manager App/Reject করতে পারে</li>
                  <li>ManagerApproved হলে Admin চূড়ান্ত অনুমোদন দেয়</li>
                </ul>

                <h4 className="font-semibold mt-2">লিভ টাইপ সেটিংস</h4>
                <PathBadge label="পথ" path="Settings {'>'} Leave Types" />
                <p>ছুটির ধরন কনফিগার: Paid/Unpaid, Annual Allocation (দিন), Max Carry Forward (দিন), Active/Inactive।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="payroll">
            <AccordionTrigger>পেরোল</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/staff/payroll" />
                <p>স্টাফ স্যালারি ও ইনকাম ট্র্যাকিং।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>স্টাফ ইনকাম (বেস স্যালারি + ওভারটাইম বোনাস) + স্টাফ পেমেন্ট দেখুন</li>
                  <li>স্টাফ ফাইন (ডিডাকশন) এন্ট্রি</li>
                  <li>আনপেইড লিভ ডিডাকশন অটোমেটিক হিসেব হয়</li>
                  <li><strong>ওভারটাইম বোনাস:</strong> অ্যাটেনডেন্স ডাটা থেকে ক্লক-আউট করা সময়ের ভিত্তিতে ক্যালকুলেট হয়</li>
                  <li>ডেট রেঞ্জ ও স্টাফ ফিল্টার</li>
                  <li>CSV Export</li>
                </ul>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  বেস স্যালারি ম্যানুয়াল এন্ট্রি (Staff Income {'>'} Salary/Manual), ওভারটাইম অটোমেটিক জেনারেট হয় অ্যাটেনডেন্স থেকে।
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="staff-assignment-report">
            <AccordionTrigger>স্টাফ অ্যাসাইনমেন্ট রিপোর্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/staff/assignment-report" />
                <p>স্টাফ-ভিত্তিক অর্ডার অ্যাসাইনমেন্ট পরিসংখ্যান: New, Confirmed, Hold, Total, Open Incomplete — সব এক জায়গায়।</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 10: WHOLESALE MANAGEMENT
// ============================================================
function WholesaleSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="হোলসেল ম্যানেজমেন্ট" icon={Building2}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="wholesale-orders">
            <AccordionTrigger>হোলসেল অর্ডার</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/wholesale/orders" />
                <p>যেসব অর্ডার "Wholesale" চ্যানেল দিয়ে তৈরি হয়েছে সেগুলো দেখুন এবং প্রসেস করুন। রেগুলার Orders পেজের মতোই ফিচার।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="approval-queue">
            <AccordionTrigger>হোলসেল অর্ডার অ্যাপ্রুভাল কিউ</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/wholesale/queue" />
                <p>অটোমেটিক Qualification Rules-এর মাধ্যমে হোলসেল হিসেবে ডিটেক্টেড অর্ডারগুলোর অ্যাপ্রুভাল কিউ।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Pending স্ট্যাটাসের অর্ডার — Approve, Reject, বা Edit & Approve অপশন</li>
                  <li>Approve করতে পারলে অর্ডার হোলসেল হিসেবে প্রসেস হবে</li>
                  <li>Reject করলে সাধারণ অর্ডার হিসেবে থাকবে</li>
                </ul>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  এটি কাস্টমার অ্যাপ্রুভাল না — অর্ডার অ্যাপ্রুভাল কিউ। Qualification Rules অটোমেটিক্যালি ডিটেক্ট করে এই কিউতে পাঠায়।
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="qualification-rules">
            <AccordionTrigger>Qualification Rules (অটো-ক্লাসিফিকেশন)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/wholesale/rules" />
                <p>কোন অর্ডার অটোমেটিক্যালি হোলসেল হিসেবে ডিটেক্ট হবে তার রুল কনফিগার করুন।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Rule Conditions:</strong> minTotalQuantity, minSubtotal, minGrandTotal, sourcePlatforms</li>
                  <li><strong>Priority:</strong> রুলের অগ্রাধিকার (প্রথমে match করা রুল প্রযোজ্য)</li>
                  <li><strong>requireApproval:</strong> চালু করলে ম্যাচড অর্ডার অ্যাপ্রুভাল কিউতে যাবে</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="pricing-settings">
            <AccordionTrigger>Pricing Settings (ডিসকাউন্ট ও প্রাইসিং)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/wholesale/settings/pricing" />
                <p>হোলসেল কাস্টমারদের জন্য ডিসকাউন্ট ও প্রাইসিং রুল তৈরি করুন।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Discount Type:</strong> Percentage, Flat Amount, Per Quantity</li>
                  <li>Tier-based কুয়ান্টিটি ডিসকাউন্ট</li>
                  <li>CustomerType (Wholesaler) ফিল্টার</li>
                  <li>Max Discount Amount ক্যাপ</li>
                  <li>SR ডিসকাউন্ট পলিসি</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="product-requests">
            <AccordionTrigger>প্রোডাক্ট রিকোয়েস্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/wholesale/product-requests" />
                <p>হোলসেল কাস্টমাররা যেসব প্রোডাক্ট রিকোয়েস্ট করছে। স্ট্যাটাস লাইফসাইকেল: Pending → Reviewing → Sourced/Completed/Rejected।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="sr-performance">
            <AccordionTrigger>SR Performance Management</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/wholesale/settings/sr-performance" />
                <p>Sales Representative-দের টার্গেট, ইনসেনটিভ পলিসি এবং পারফরম্যান্স ট্র্যাকিং সিস্টেম।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Leaderboard ট্যাব:</strong> পারফরম্যান্স র‌্যাঙ্কিং — Active Targets, Completed, Confirmed ৳, Pending ৳, Total ৳</li>
                  <li><strong>Targets ট্যাব:</strong> ডেট রেঞ্জ, amount/quantity টার্গেট, ইনসেনটিভ পলিসি সহ টার্গেট তৈরি ও এডিট</li>
                  <li><strong>Policies ট্যাব:</strong> Commission rate বা Flat bonus পলিসি তৈরি</li>
                </ul>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  SR Performance-এ update-level permission লাগে। এটা শুধু রিপোর্ট না — পূর্ণাঙ্গ ম্যানেজমেন্ট টুল।
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 11: INTEGRATIONS
// ============================================================
function IntegrationsSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="ওয়েবসাইট ইন্টিগ্রেশন" icon={Store}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="website-integration">
            <AccordionTrigger>ওয়েবসাইট ইন্টিগ্রেশন (WooCommerce + Custom Sites)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Integrations" />
                <p>এখন WooCommerce ছাড়াও Laravel, Next.js, বা যেকোনো Custom ওয়েবসাইট কানেক্ট করতে পারবেন। কানেক্ট করলে অনলাইন অর্ডার স্বয়ংক্রিয়ভাবে EcoMate-তে আসবে, প্রোডাক্ট ও স্টক স্ট্যাটাস অ্যাক্সেস করা যাবে।</p>

                <h4 className="font-semibold">সাপোর্টেড প্লাটফর্ম</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="bg-purple-50 dark:bg-purple-950/20 p-2 rounded text-xs">
                    <strong>WooCommerce</strong> — REST API + Webhook
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/20 p-2 rounded text-xs">
                    <strong>Laravel</strong> — Generic API v1
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-950/20 p-2 rounded text-xs">
                    <strong>Next.js</strong> — Generic API v1
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/20 p-2 rounded text-xs">
                    <strong>Custom</strong> — Generic API v1
                  </div>
                </div>

                <h4 className="font-semibold mt-4">ধাপ ১: Integration তৈরি</h4>
                <Step num={1}>Settings {'>'} Integrations এ যান</Step>
                <Step num={2}>"Add Integration" এ ক্লিক করুন</Step>
                <Step num={3}>Platform সিলেক্ট করুন (WooCommerce / Laravel / Next.js / Custom)</Step>
                <Step num={4}>Business সিলেক্ট করুন (আগে Business তৈরি থাকতে হবে)</Step>
                <Step num={5}>Site Name ও Site URL/Domain দিন</Step>
                <Step num={6}>WooCommerce হলে Consumer Key ও Secret দিন। অন্যান্য প্লাটফর্মে দরকার নেই।</Step>
                <Step num={7}>"Generate" বাটনে ক্লিক করে API Key তৈরি করুন</Step>
                <Step num={8}>Custom সাইটের জন্য চাইলে Status Callback URL দিন (ঐচ্ছিক)</Step>
                <Step num={9}>Save Integration করুন</Step>

                <h4 className="font-semibold">ধাপ ২: External Site-এ ইন্টিগ্রেট করুন</h4>
                
                <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 p-4 rounded-lg">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Download className="h-4 w-4" />
                    WooCommerce Plugin (শুধু WooCommerce-এর জন্য)
                  </h4>
                  <p className="mt-2 mb-3">WooCommerce সাইটে প্লাগিন ইন্সটল করুন।</p>
                  <a 
                    href="/downloads/ecomate-woo-plugin.zip" 
                    download
                    className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 transition-colors text-sm"
                  >
                    <Download className="h-4 w-4" />
                    প্লাগিন ডাউনলোড করুন
                  </a>
                  <Step num={1}>ZIP ফাইল WordPress-এ আপলোড করে Activate করুন</Step>
                  <Step num={2}>EcoMate Settings-এ API Key বসান</Step>
                  <Step num={3}>Webhook URL কপি করে WooCommerce Webhooks-এ সেট করুন</Step>
                </div>

                <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-4 rounded-lg mt-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Globe className="h-4 w-4" />
                    Laravel / Next.js / Custom Sites
                  </h4>
                  <p className="mt-2">Integration save করার পর ডায়ালগে API Endpoints দেখাবে। আপনার ডেভেলপারকে নিচের এন্ডপয়েন্টে ইন্টিগ্রেট করতে বলুন:</p>
                  <div className="bg-muted p-2 rounded mt-2 text-xs font-mono space-y-1">
                    <p>Orders পাঠান: <code>POST /api/v1/orders</code></p>
                    <p>প্রোডাক্ট দেখুন: <code>GET /api/v1/products</code></p>
                    <p>স্টক চেক: <code>GET /api/v1/stock/{'{sku}'}</code></p>
                    <p>অর্ডার স্ট্যাটাস: <code>GET /api/v1/orders/{'{id}'}/status</code></p>
                    <p>Incomplete Order: <code>POST /api/v1/incomplete-orders</code></p>
                    <p className="mt-1">Auth: <code>Bearer {'<API Key>'}</code></p>
                  </div>
                </div>

                <h4 className="font-semibold mt-4">ইন্টিগ্রেশন সেটিংস</h4>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Auto-Sync:</strong> (শুধু WooCommerce) নতুন অর্ডার স্বয়ংক্রিয়ভাবে সিঙ্ক করবে</li>
                  <li><strong>Incomplete Order Capture:</strong> অসম্পূর্ণ অর্ডার ট্র্যাক করবে</li>
                  <li><strong>Order Restrictions:</strong> ফোন/IP অনুযায়ী অর্ডার লিমিট</li>
                  <li><strong>Status Callback URL:</strong> অর্ডার স্ট্যাটাস চেঞ্জ হলে আপনার সাইটে নোটিফিকেশন পাঠাবে</li>
                </ul>

                <Prereq>Business আগে তৈরি করতে হবে।</Prereq>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="sms">
            <AccordionTrigger>SMS Gateway</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Gateways {'>'} SMS" />
                <p>SMS গেটওয়ে কনফিগার করলে অর্ডার কনফারমেশন, ডেলিভারি আপডেট ইত্যাদি SMS পাঠানো যাবে।</p>
                <Step num={1}>Settings {'>'} Gateways {'>'} SMS এ যান</Step>
                <Step num={2}>Username (ইমেইল), API Key, Sender Name দিন</Step>
                <Step num={3}>Enabled টগল চালু করুন</Step>
                <Step num={4}>টেস্ট SMS পাঠান</Step>
                <Step num={5}>Save করুন</Step>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="smtp">
            <AccordionTrigger>SMTP (ইমেইল)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Gateways {'>'} SMTP" />
                <p>SMTP কনফিগার করলে সিস্টেম থেকে ইমেইল পাঠানো যাবে।</p>
                <Step num={1}>Settings {'>'} Gateways {'>'} SMTP এ যান</Step>
                <Step num={2}>SMTP Host, Port দিন</Step>
                <Step num={3}>Username ও Password দিন</Step>
                <Step num={4}>Encryption সিলেক্ট করুন (TLS/SSL/None)</Step>
                <Step num={5}>Save করুন</Step>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="webhook">
            <AccordionTrigger>Webhook কনফিগারেশন</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/webhook-failures" />
                <p>Webhook ফেইলিওর ট্র্যাকিং। WooCommerce বা কুরিয়ার থেকে আসা ফেইলড webhook এখানে দেখা যায়।</p>
                <Consequence>Webhook সঠিকভাবে কনফিগার না করলে অর্ডার স্ট্যাটাস আপডেট স্বয়ংক্রিয়ভাবে হবে না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 12: MARKETING
// ============================================================
function MarketingSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="মার্কেটিং" icon={Megaphone}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="campaigns">
            <AccordionTrigger>ক্যাম্পেইন ট্র্যাকিং</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/marketing" />
                <p>মার্কেটিং ক্যাম্পেইনের খরচ ট্র্যাক এবং অর্ডার অ্যাট্রিবিউট করুন। কোন ক্যাম্পেইন থেকে কত অর্ডার এসেছে, কত খরচ হয়েছে, ROAS কেমন — সব ট্র্যাক করা যায়।</p>

                <h4 className="font-semibold mt-2">মূল ফিচারসমূহ</h4>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>ক্যাম্পেইন তৈরি:</strong> নাম, টার্গেট CPR, ট্র্যাকড প্রোডাক্ট, Marketer অ্যাসাইন করুন</li>
                  <li><strong>খরচ ট্র্যাক:</strong> প্রতি ক্যাম্পেইনে বিজ্ঞাপন খরচ (Ad Spend) এন্ট্রি করুন</li>
                  <li><strong>অর্ডার অ্যাট্রিবিউট:</strong> ম্যানুয়ালি অর্ডার নম্বর দিয়ে বা অটোমেটিক UTM প্যারামিটার (utm_campaign/utm_id) দিয়ে অর্ডার ক্যাম্পেইনের সাথে লিঙ্ক করুন</li>
                  <li><strong>KPI ড্যাশবোর্ড:</strong> Total Spend, Attributed Orders, CPR, ROAS, Profit — সব ক্যাম্পেইনের পারফরম্যান্স এক জায়গায়</li>
                  <li><strong>Admin ভিউ:</strong> Revenue - COGS - Courier - Ad Spend - Real Profit ব্রেকডাউন</li>
                </ul>

                <h4 className="font-semibold mt-2">UTM অটো-অ্যাট্রিবিউশন</h4>
                <p>WooCommerce বা জেনেরিক সাইট থেকে অর্ডার আসার সময় payload-এ <code>landingPage</code> URL দিলে সিস্টেম অটোমেটিকভাবে utm_campaign/utm_id প্যারামিটার থেকে ক্যাম্পেইন শনাক্ত করে অর্ডার অ্যাট্রিবিউট করে দেয়।</p>

                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  Marketer রোলের স্টাফরা শুধু /dashboard/marketing পেজ অ্যাক্সেস করতে পারে। Admin রোলের জন্য /dashboard/marketing/admin পেজ আছে।
                </div>

                <Prereq>ক্যাম্পেইনের সাথে অর্ডার অ্যাট্রিবিউট করতে Products সেটআপ থাকতে হবে। WooCommerce/Generic ইন্টিগ্রেশন থাকলে UTM অটো-অ্যাট্রিবিউশন কাজ করে।</Prereq>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 13: REPORTING & ANALYTICS
// ============================================================
function ReportingSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="রিপোর্টিং ও অ্যানালিটিক্স" icon={BarChart3}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="analytics">
            <AccordionTrigger>অ্যানালিটিক্স ড্যাশবোর্ড</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/analytics" />
                <p>ফাইন্যান্সিয়াল KPI ড্যাশবোর্ড।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Gross Order Value, Gross Before Discount, Total Revenue, COGS</li>
                  <li>Gross Profit, Total Expenses, Ad Expense, Net Profit</li>
                  <li>মাসিক Performance চার্ট (Revenue/Expenses/Profit)</li>
                  <li>Expense Breakdown পাই চার্ট</li>
                  <li>P&L টেবিল</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="sale-report">
            <AccordionTrigger>সেল রিপোর্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/orders/sale-report" />
                <p>ডেট প্রি-সেট (Today/Yesterday/Last 7/Last 30/Custom) ও বিজনেস ফিল্টার দিয়ে সেল রিপোর্ট।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>প্রতি বিজনেসের Status-wise Activity Counts</li>
                  <li>Print/PDF অপশন</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="courier-report">
            <AccordionTrigger>কুরিয়ার রিপোর্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/courier-report" />
                <p>কুরিয়ার-ভিত্তিক পার্সেল পরিসংখ্যান।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>ফোন নম্বর দিয়ে সার্চ</li>
                  <li>প্রতি কুরিয়ার: Total Parcels, Delivered, Canceled (কাউন্ট)</li>
                  <li>Delivery ও Cancellation Ratio প্রোগ্রেস বার</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="attendance-report">
            <AccordionTrigger>অ্যাটেনডেন্স রিপোর্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/attendance" />
                <p>ডেইলি রোস্টার ভিউ — প্রত্যাশিত বনাম প্রকৃত সময়, ওভারটাইম মিনিট ও OT বোনাস।</p>
                <PathBadge label="পথ" path="/dashboard/attendance/calendar" />
                <p>মাসিক ক্যালেন্ডার ভিউতে সবার উপস্থিতি।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="pos-report">
            <AccordionTrigger>POS সেল রিপোর্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/pos/reports" />
                <p>Showroom, Staff, Date Range দিয়ে POS বিক্রয়ের রিপোর্ট। Order Count, Total Collected, Refunded, Net Collected, Order Value, Payment Method ও Status ব্রেকডাউন।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="task-report">
            <AccordionTrigger>টাস্ক রিপোর্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="/dashboard/tasks/report" />
                <p>স্টাফ-ভিত্তিক টাস্ক কমপ্লিশন রিপোর্ট।</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 14: OTHER SETTINGS
// ============================================================
function OtherSettingsSection() {
  return (
    <div className="space-y-6">
      <SectionCard title="অন্যান্য সেটিংস" icon={Shield}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="shifts">
            <AccordionTrigger>শিফট ম্যানেজমেন্ট</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Shifts" />
                <p>স্টাফ শিফট টেমপ্লেট তৈরি করুন। রোল অনুযায়ী শিফট অ্যাসাইন করা যায়।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>শিফটের নাম, রোল সিলেক্ট (যেমন: Call Assistant, Packing Assistant)</li>
                  <li>স্টার্ট টাইম ও এন্ড টাইম</li>
                  <li>Late Grace Minutes, Early Leave Grace Minutes</li>
                </ul>
                <Consequence>শিফট তৈরি না করলে অ্যাটেনডেন্স সিস্টেম সঠিকভাবে কাজ করবে না।</Consequence>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="leave-types">
            <AccordionTrigger>লিভ টাইপস</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Leave Types" />
                <p>ছুটির ধরন কনফিগার করুন।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>নাম, Paid/Unpaid</li>
                  <li>Annual Allocation (দিন) ও Max Carry Forward (দিন)</li>
                  <li>Active/Inactive টগল</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="cutoff">
            <AccordionTrigger>Cut-Off Accounting Boundary</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Cutoff" />
                <p>অ্যাকাউন্টিং পিরিয়ড ক্লোজার টুল — নির্দিষ্ট তারিখ থেকে অফিসিয়াল হিসাব শুরু করুন, আগের ডাটা অপরিবর্তিত রেখে।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li><strong>Revision Management:</strong> Create, Inspect, Validate, Apply</li>
                  <li><strong>Opening Balances:</strong> সাজেস্টেড + ওভাররাইডেবল ওপেনিং ব্যালেন্স (Entity Type অনুযায়ী)</li>
                  <li><strong>Opening Inventory Snapshots:</strong> প্রতি প্রোডাক্ট, লট-লেভেল ডিটেইল</li>
                  <li><strong>Work-in-Progress:</strong> প্রতি প্রোডাক্ট, প্রোডাকশন স্টেপ অনুযায়ী WIP এন্ট্রি</li>
                  <li>Audit Logs, Validation Checks (Errors/Warnings)</li>
                  <li>Apply করলে অপরিবর্তনীয় — শুধু Super Admin করতে পারে</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="delivery-score">
            <AccordionTrigger>Delivery Score (Courier Search API)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Delivery Score" />
                <p>Hoorin Courier Search সার্ভিসের API Key কনফিগারেশন।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Enable/Disable কুরিয়ার রিপোর্ট পেজ</li>
                  <li>API Key (Hoorin Dash), Referer (optional)</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="badges">
            <AccordionTrigger>ব্যাজ (Badges)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Badges" />
                <p>স্টাফ বা কাস্টমারদের প্রোফাইলে দেখানোর জন্য কাস্টম ব্যাজ। চার গ্রুপ: Customer Orders, Staff Orders Created, Staff Orders Confirmed, Staff Delivery Success। প্রতিটায় configurable labels, min thresholds, colors।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="accounting-settings">
            <AccordionTrigger>Chart of Accounts</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Accounting" />
                <p>একাউন্টের চার্ট তৈরি ও ম্যানেজ করুন। Account Name, Type (Asset/Liability/Equity/Revenue/Expense), Group — সব কনফিগার করা যায়।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="backups">
            <AccordionTrigger>ব্যাকআপ</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Backups" />
                <p>Cloudflare R2-তে অটোমেটেড ডাটাবেস ব্যাকআপ।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Enable/Disable, Access Key, Secret Key, Endpoint, Bucket</li>
                  <li>Frequency: Hourly/Daily/Weekly, Interval, Retention Count</li>
                  <li>Snapshot লিস্ট ও Restore অপশন</li>
                </ul>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="notifications">
            <AccordionTrigger>নোটিফিকেশন (SMS ও ইমেইল টেমপ্লেট)</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <PathBadge label="পথ" path="Settings {'>'} Notifications" />
                <p>অর্ডার স্ট্যাটাস, Purchase Order, Staff (Payment/Fine), Partner (Payment/Bill) — বিভিন্ন ইভেন্টের জন্য SMS ও Email টেমপ্লেট কাস্টমাইজ করুন।</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Order Status টেমপ্লেট (প্রতি status-এ SMS + Email)</li>
                  <li>Purchase Order টেমপ্লেট</li>
                  <li>Staff Notification (Payment Cleared, Fine Recorded)</li>
                  <li>Partner Notification (Partner Payment, Bill Created)</li>
                </ul>
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg text-sm">
                  <Info className="h-4 w-4 inline mr-1" />
                  এটি ইন-অ্যাপ নোটিফিকেশন না — SMS ও ইমেইল আউটবাউন্ড টেমপ্লেট কনফিগারেশন। ইন-অ্যাপ নোটিফিকেশন হিস্টোরি দেখতে /dashboard/notifications পেজ ব্যবহার করুন।
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}

// ============================================================
// SECTION 15: API DOCUMENTATION
// ============================================================
function APISection() {
  return (
    <div className="space-y-6">
      <SectionCard title="API ডকুমেন্টেশন" icon={Key}>
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="overview">
            <AccordionTrigger>API Overview</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>EcoMate REST API v1 — বাহ্যিক ওয়েবসাইট (Laravel, Next.js, Custom) ইন্টিগ্রেশনের জন্য।</p>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p><strong>Base URL:</strong> <code className="bg-background px-1 py-0.5 rounded">https://your-domain.com/api/v1</code></p>
                  <p><strong>Authentication:</strong> <code className="bg-background px-1 py-0.5 rounded">Authorization: Bearer sk_xxx...</code></p>
                  <p><strong>Format:</strong> JSON</p>
                  <p><strong>Rate Limit:</strong> Per-integration, varies per endpoint (see below)</p>
                </div>
                <p className="mt-2">API Key Settings {'>'} Integrations থেকে Generate করুন। Integration save করার পর এন্ডপয়েন্টগুলো দেখতে পাবেন।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="order-submit">
            <AccordionTrigger>POST /api/v1/orders — Order Submit</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>External সাইট থেকে অর্ডার EcoMate-এ পাঠানোর এন্ডপয়েন্ট।</p>
                <p><strong>Rate Limit:</strong> 120 req/min</p>
                
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="font-semibold mb-2">Request Body:</p>
                  <pre className="bg-background p-2 rounded text-xs overflow-x-auto">{`{
  "externalOrderId": "ORD-12345",
  "customer": {
    "name": "Rahim Uddin",
    "phone": "01712345678",
    "email": "rahim@example.com",
    "address": "House 12, Road 5, Gulshan",
    "district": "Dhaka",
    "city": "Gulshan"
  },
  "items": [
    {
      "sku": "TSHIRT-BLUE-M",
      "quantity": 2,
      "price": 500,
      "name": "Blue T-Shirt M"
    }
  ],
  "paymentMethod": "CashOnDelivery",
  "note": "Please deliver before 5pm",
  "landingPage": "https://shop.com/fb-ad"
}`}</pre>
                </div>

                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="font-semibold mb-2">Success Response (201):</p>
                  <pre className="bg-background p-2 rounded text-xs overflow-x-auto">{`{
  "success": true,
  "message": "Order received",
  "orderId": "nextjs-int_abc123-ORD-12345"
}`}</pre>
                </div>

                <p><strong>paymentMethod:</strong> CashOnDelivery, bKash, Nagad</p>
                <p><strong>landingPage:</strong> UTM attribution URL (optional)</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="order-status">
            <AccordionTrigger>GET /api/v1/orders/:id/status — Order Status</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>External সাইট থেকে অর্ডার স্ট্যাটাস চেক করার এন্ডপয়েন্ট।</p>
                <p><strong>Rate Limit:</strong> 60 req/min</p>
                <p><strong>:id</strong> = externalOrderId (যা অর্ডার সাবমিট করার সময় দিয়েছিলেন)</p>

                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="font-semibold mb-2">Example: <code className="text-xs">GET /api/v1/orders/ORD-12345/status</code></p>
                  <pre className="bg-background p-2 rounded text-xs overflow-x-auto">{`{
  "success": true,
  "data": {
    "externalOrderId": "ORD-12345",
    "status": "Shipped",
    "total": 1000,
    "customerName": "Rahim Uddin",
    "courierService": "Steadfast",
    "courierConsignmentId": "ST-98765",
    "courierMeta": { "trackingUrl": "https://..." },
    "createdAt": "2026-05-12T10:00:00.000Z",
    "updatedAt": "2026-05-12T14:30:00.000Z"
  }
}`}</pre>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="products-list">
            <AccordionTrigger>GET /api/v1/products — Product List</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>EcoMate থেকে প্রোডাক্ট লিস্ট ও স্টক ইনফরমেশন fetch করার এন্ডপয়েন্ট।</p>
                <p><strong>Rate Limit:</strong> 60 req/min</p>
                <p><strong>Cache:</strong> 30 seconds Redis cache</p>

                <div className="bg-muted/50 p-3 rounded-lg overflow-x-auto">
                  <p className="font-semibold mb-2">Query Parameters:</p>
                  <table className="min-w-[400px] w-full text-xs">
                    <thead><tr><th className="text-left p-1">Param</th><th className="text-left p-1">Type</th><th className="text-left p-1">Default</th><th className="text-left p-1">Description</th></tr></thead>
                    <tbody>
                      <tr><td className="p-1">page</td><td className="p-1">number</td><td className="p-1">1</td><td className="p-1">Page number</td></tr>
                      <tr><td className="p-1">limit</td><td className="p-1">number</td><td className="p-1">50</td><td className="p-1">Items per page (max 100)</td></tr>
                      <tr><td className="p-1">sku</td><td className="p-1">string</td><td className="p-1">-</td><td className="p-1">Filter by SKU (partial match)</td></tr>
                      <tr><td className="p-1">search</td><td className="p-1">string</td><td className="p-1">-</td><td className="p-1">Search by product name</td></tr>
                    </tbody>
                  </table>
                </div>

                <p><strong>Example:</strong> <code className="text-xs">GET /api/v1/products?page=1&limit=10&sku=TSHIRT</code></p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="stock-check">
            <AccordionTrigger>GET /api/v1/stock/:sku — Stock Check</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>একটি নির্দিষ্ট SKU-র স্টক স্ট্যাটাস চেক করার এন্ডপয়েন্ট।</p>
                <p><strong>Rate Limit:</strong> 120 req/min</p>

                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="font-semibold mb-2">Example: <code className="text-xs">GET /api/v1/stock/TSHIRT-BLUE-M</code></p>
                  <pre className="bg-background p-2 rounded text-xs overflow-x-auto">{`{
  "success": true,
  "data": {
    "sku": "TSHIRT-BLUE-M",
    "name": "Blue T-Shirt (M)",
    "price": 500,
    "salePrice": 450,
    "isPublished": true,
    "stockQuantity": 25,
    "stockReserved": 3,
    "stockAvailable": 22,
    "stockStatus": "in_stock",
    "variants": [...]
  }
}`}</pre>
                </div>

                <p><strong>stockStatus values:</strong> <code>in_stock</code> | <code>out_of_stock</code> | <code>unpublished</code></p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="incomplete-order">
            <AccordionTrigger>POST /api/v1/incomplete-orders — Incomplete Order Capture</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>অসম্পূর্ণ/পরিত্যক্ত অর্ডার ট্র্যাক করার এন্ডপয়েন্ট (Incomplete Order Capture চালু থাকলে কাজ করে)।</p>
                <p><strong>Rate Limit:</strong> 60 req/min</p>

                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="font-semibold mb-2">Request Body:</p>
                  <pre className="bg-background p-2 rounded text-xs overflow-x-auto">{`{
  "phone": "01712345678",
  "name": "Karim",
  "address": "Mirpur, Dhaka",
  "items": [
    { "sku": "TSHIRT-RED-L", "name": "Red T-Shirt L" }
  ],
  "landingPage": "https://shop.com/ad1"
}`}</pre>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="rate-limit">
            <AccordionTrigger>Rate Limiting</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>প্রতিটি API key-র জন্য প্রতি-এন্ডপয়েন্ট রেট লিমিট রয়েছে:</p>
                <div className="overflow-x-auto">
                  <table className="min-w-[300px] w-full text-xs">
                    <thead><tr><th className="text-left p-1">Endpoint</th><th className="text-left p-1">Requests/min</th></tr></thead>
                    <tbody>
                      <tr><td className="p-1">POST /api/v1/orders</td><td className="p-1">120</td></tr>
                      <tr><td className="p-1">GET /api/v1/orders/:id/status</td><td className="p-1">60</td></tr>
                      <tr><td className="p-1">GET /api/v1/products</td><td className="p-1">60</td></tr>
                      <tr><td className="p-1">GET /api/v1/stock/:sku</td><td className="p-1">120</td></tr>
                      <tr><td className="p-1">POST /api/v1/incomplete-orders</td><td className="p-1">60</td></tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-2">Rate limit exceeded হলে <code className="bg-muted px-1 rounded">429 Too Many Requests</code> রেসপন্স আসবে। Response header-এ <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Reset</code> থাকবে।</p>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="webhook-endpoints">
            <AccordionTrigger>WooCommerce Webhook Endpoints</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-sm">
                <p>শুধুমাত্র WooCommerce ইন্টিগ্রেশনের জন্য — এগুলো external Laravel/Next.js সাইট ব্যবহার করে না:</p>
                <div className="bg-muted/50 p-3 rounded-lg font-mono text-xs space-y-1">
                  <p><strong>POST</strong> /api/webhooks/woo/[id] — WooCommerce webhook receiver</p>
                  <p><strong>POST</strong> /api/orders/import/woo — Manual WC order import</p>
                  <p><strong>POST</strong> /api/woo/restriction-check — Phone/IP check</p>
                  <p><strong>POST</strong> /api/woo/incomplete-orders — WC incomplete orders</p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SectionCard>
    </div>
  );
}