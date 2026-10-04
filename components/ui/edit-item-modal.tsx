"use client";

import { Modal } from "./modal";
import { Button } from "./button";
import { Input } from "./input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: EditableItem) => void;
  item: EditableItem | null;
  isEditing?: boolean;
  isSlow?: boolean;
}

export interface EditableItem {
  title: string;
  category: string;
  language: string | string[];
  year: number;
  first: string;
  last: string;
  editedtranslated: string | string[] | null;
  sheetId: string;
}

export function EditItemModal({
  isOpen,
  onClose,
  onSave,
  item,
  isEditing = false,
  isSlow = false
}: EditItemModalProps) {
  const [formData, setFormData] = useState<EditableItem | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (item) {
      setFormData({ ...item });
      setErrors({});
    }
  }, [item]);

  const handleClose = () => {
    if (!isEditing) {
      onClose();
    }
  };

  const handleInputChange = (field: keyof EditableItem, value: string | number) => {
    if (!formData) return;
    
    setFormData({
      ...formData,
      [field]: value
    });
    
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleCategorySelect = (category: string) => {
    if (!formData) return;
    
    setFormData({
      ...formData,
      category: category
    });
    
    if (errors.category) {
      setErrors(prev => ({ ...prev, category: '' }));
    }
  };

  const handleLanguageSelect = (languageCode: string) => {
    if (!formData) return;
    
    const currentLanguages = Array.isArray(formData.language) ? formData.language : (formData.language ? [formData.language] : []);
    
    if (currentLanguages.includes(languageCode)) {
      // Remove if already selected
      const newLanguages = currentLanguages.filter(lang => lang !== languageCode);
      setFormData({
        ...formData,
        language: newLanguages.length === 1 ? newLanguages[0] : newLanguages
      });
    } else {
      // Add if not selected
      const newLanguages = [...currentLanguages, languageCode];
      setFormData({
        ...formData,
        language: newLanguages.length === 1 ? newLanguages[0] : newLanguages
      });
    }
    
    if (errors.language) {
      setErrors(prev => ({ ...prev, language: '' }));
    }
  };

  const handleEditedTranslatedSelect = (editedCode: string) => {
    if (!formData) return;
    
    const currentItems = Array.isArray(formData.editedtranslated) ? formData.editedtranslated : (formData.editedtranslated ? [formData.editedtranslated] : []);
    
    if (currentItems.includes(editedCode)) {
      // Remove if already selected
      const newItems = currentItems.filter(item => item !== editedCode);
      setFormData({
        ...formData,
        editedtranslated: newItems.length === 0 ? null : (newItems.length === 1 ? newItems[0] : newItems)
      });
    } else {
      // Add if not selected
      const newItems = [...currentItems, editedCode];
      setFormData({
        ...formData,
        editedtranslated: newItems.length === 1 ? newItems[0] : newItems
      });
    }
    
    if (errors.editedtranslated) {
      setErrors(prev => ({ ...prev, editedtranslated: '' }));
    }
  };

  const validateForm = (): boolean => {
    if (!formData) return false;
    
    const newErrors: Record<string, string> = {};
    
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }
    
    if (!formData.category.trim()) {
      newErrors.category = 'Category is required';
    }
    
    // Only validate year format if a year is provided
    if (formData.year && (formData.year < 1000 || formData.year > 9999)) {
      newErrors.year = 'Year must be a valid 4-digit year';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!formData || !validateForm()) return;
    
    onSave(formData);
  };

  if (!formData) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose}>
      <div className="p-6 bg-white">
        <div className="mb-4">
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Edit Catalog Item
          </h3>
          <p className="text-sm text-gray-500">
            Update the catalog item information below.
          </p>
        </div>

        <div className="space-y-4 max-h-96 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <Input
              type="text"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              disabled={isEditing}
              className={errors.title ? 'border-red-500' : ''}
            />
            {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category *
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    className={`w-full justify-between ${errors.category ? 'border-red-500' : ''}`}
                    disabled={isEditing}
                  >
                    {(() => {
                      if (!formData.category) return "Select category";
                      return formData.category;
                    })()}
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full max-h-60 overflow-y-auto">
                  {[
                    { code: "SRK", name: "Sri Ramakrishna, Life & Teachings" },
                    { code: "HMS", name: "Holy Mother, Life and Teachings" },
                    { code: "VIV", name: "Swami Vivekananda, Life & Teachings" },
                    { code: "DDL", name: "Lives of Direct Disciples of Sri Ramakrishna" },
                    { code: "ODL", name: "Lives of Other Disciples" },
                    { code: "UVO", name: "Upanishads, Vedas, Sutras etc." },
                    { code: "SMH", name: "Songs, Mantra, Shlokas, Prayers & Hymns" },
                    { code: "MNP", name: "Mythology & Puranas" },
                    { code: "GIT", name: "Gita" },
                    { code: "VED", name: "Vedanta Philosophy" },
                    { code: "OPH", name: "Other Philosophies" },
                    { code: "SCI", name: "Science" },
                    { code: "HIS", name: "History" },
                    { code: "SNK", name: "Sankara" },
                    { code: "DMW", name: "Divine mother worship" },
                    { code: "SPD", name: "Spiritual Practice & Discipline" },
                    { code: "SER", name: "Service to humanity" },
                    { code: "PIL", name: "Pilgrimage & Tourism" },
                    { code: "SHR", name: "Subset of Hindu religion" },
                    { code: "CLB", name: "Class books" },
                    { code: "KID", name: "Children" }
                  ].map((category) => (
                    <DropdownMenuItem
                      key={category.code}
                      onClick={() => handleCategorySelect(category.code)}
                      className="cursor-pointer flex flex-col items-start"
                    >
                      <div className="font-medium">{category.code}</div>
                      <div className="text-xs text-gray-500">{category.name}</div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {errors.category && <p className="text-red-500 text-xs mt-1">{errors.category}</p>}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Year
              </label>
              <Input
                type="number"
                value={formData.year || ''}
                onChange={(e) => handleInputChange('year', parseInt(e.target.value) || 0)}
                disabled={isEditing}
                className={errors.year ? 'border-red-500' : ''}
                placeholder="Optional"
              />
              {errors.year && <p className="text-red-500 text-xs mt-1">{errors.year}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Language *
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  className={`w-full justify-between ${errors.language ? 'border-red-500' : ''}`}
                  disabled={isEditing}
                >
                  {(() => {
                    const selectedLanguages = Array.isArray(formData.language) 
                      ? formData.language 
                      : (formData.language ? [formData.language] : []);
                    
                    if (selectedLanguages.length === 0) {
                      return "Select language(s)";
                    } else if (selectedLanguages.length === 1) {
                      const langMap: Record<string, string> = {
                        "E": "English",
                        "S": "Sanskrit", 
                        "H": "Hindi",
                        "B": "Bengali",
                        "T": "Tamil"
                      };
                      return langMap[selectedLanguages[0]] || selectedLanguages[0];
                    } else {
                      return `${selectedLanguages.length} languages selected`;
                    }
                  })()}
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-full">
                {[
                  { code: "E", name: "English" },
                  { code: "S", name: "Sanskrit" },
                  { code: "H", name: "Hindi" },
                  { code: "B", name: "Bengali" },
                  { code: "T", name: "Tamil" }
                ].map((language) => {
                  const selectedLanguages = Array.isArray(formData.language) 
                    ? formData.language 
                    : (formData.language ? [formData.language] : []);
                  const isSelected = selectedLanguages.includes(language.code);
                  
                  return (
                    <DropdownMenuItem
                      key={language.code}
                      onClick={() => handleLanguageSelect(language.code)}
                      className="cursor-pointer flex items-center gap-2"
                    >
                      <div className={`w-4 h-4 border rounded flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-gray-300'}`}>
                        {isSelected && <div className="w-2 h-2 bg-white rounded-sm" />}
                      </div>
                      {language.code} - {language.name}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {errors.language && <p className="text-red-500 text-xs mt-1">{errors.language}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name
              </label>
              <Input
                type="text"
                value={formData.first}
                onChange={(e) => handleInputChange('first', e.target.value)}
                disabled={isEditing}
                placeholder="Optional"
                className={errors.first ? 'border-red-500' : ''}
              />
              {errors.first && <p className="text-red-500 text-xs mt-1">{errors.first}</p>}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name
              </label>
              <Input
                type="text"
                value={formData.last}
                onChange={(e) => handleInputChange('last', e.target.value)}
                disabled={isEditing}
                placeholder="Optional"
                className={errors.last ? 'border-red-500' : ''}
              />
              {errors.last && <p className="text-red-500 text-xs mt-1">{errors.last}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ID
            </label>
            <Input
              type="text"
              value={formData.sheetId}
              onChange={(e) => handleInputChange('sheetId', e.target.value)}
              disabled={isEditing}
              placeholder="Optional — e.g. 1029 VIV-E 5.1"
              className={errors.sheetId ? 'border-red-500' : ''}
            />
            {errors.sheetId && <p className="text-red-500 text-xs mt-1">{errors.sheetId}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Edited/Translated
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  className="w-full justify-between"
                  disabled={isEditing}
                >
                  {(() => {
                    const selectedItems = Array.isArray(formData.editedtranslated) 
                      ? formData.editedtranslated 
                      : (formData.editedtranslated ? [formData.editedtranslated] : []);
                    
                    if (selectedItems.length === 0) {
                      return "Select edited/translated";
                    } else if (selectedItems.length === 1) {
                      const itemMap: Record<string, string> = {
                        "T": "Translated",
                        "E": "Edited", 
                        "A": "Adapted",
                        "C": "Compiled"
                      };
                      return itemMap[selectedItems[0]] || selectedItems[0];
                    } else {
                      return `${selectedItems.length} options selected`;
                    }
                  })()}
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-full">
                {[
                  { code: "T", name: "Translated" },
                  { code: "E", name: "Edited" },
                  { code: "A", name: "Adapted" },
                  { code: "C", name: "Compiled" }
                ].map((item) => {
                  const selectedItems = Array.isArray(formData.editedtranslated) 
                    ? formData.editedtranslated 
                    : (formData.editedtranslated ? [formData.editedtranslated] : []);
                  const isSelected = selectedItems.includes(item.code);
                  
                  return (
                    <DropdownMenuItem
                      key={item.code}
                      onClick={() => handleEditedTranslatedSelect(item.code)}
                      className="cursor-pointer flex items-center gap-2"
                    >
                      <div className={`w-4 h-4 border rounded flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-gray-300'}`}>
                        {isSelected && <div className="w-2 h-2 bg-white rounded-sm" />}
                      </div>
                      {item.code} - {item.name}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isEditing}
            className="px-4 py-2"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isEditing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
          >
            {isEditing
              ? isSlow
                ? "Still working — server is starting up…"
                : "Saving..."
              : "Save Changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
