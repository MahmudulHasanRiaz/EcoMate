
import { placeholderImages } from './placeholder-images-data';

export type ImagePlaceholder = {
  id: string;
  description: string;
  imageUrl: string;
  imageHint: string;
};

export const PlaceHolderImages: ImagePlaceholder[] = placeholderImages.map(img => ({
    id: img.id,
    description: img.description,
    imageUrl: img.imageUrl,
    imageHint: img.imageHint
}));
