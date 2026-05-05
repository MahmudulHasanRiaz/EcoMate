
import { Package } from "lucide-react";

const ComingSoonPage = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 text-center p-4">
      <div className="max-w-md w-full">
        <div className="mb-8">
          <Package className="mx-auto h-24 w-24 text-gray-400 dark:text-gray-500" />
        </div>
        <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-200 mb-4">
          Coming Soon!
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">
          We are working hard to bring you new and exciting features.
        </p>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Insha&apos;Allah, this module will be available very soon.
        </p>
      </div>
    </div>
  );
};

export default ComingSoonPage;
