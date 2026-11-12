<script setup lang="ts">
import { computed } from 'vue';
import { NCheckbox, NFormItem, NInputNumber, NSelect, NSlider } from 'naive-ui';
import type { OutputFormat, ProcessOptions } from '../types';

const model = defineModel<ProcessOptions>({ required: true });

const formatOptions = [
  { label: 'WebP', value: 'webp' },
  { label: 'JPEG', value: 'jpeg' },
  { label: 'PNG', value: 'png' },
  { label: 'AVIF', value: 'avif' },
];

const changeFormat = computed(() => model.value.format !== null);

const selectedFormat = computed({
  get: () => model.value.format ?? 'webp',
  set: (value: OutputFormat) => {
    if (value !== null) {
      model.value = { ...model.value, format: value };
    }
  },
});

function onFormatToggle(checked: boolean) {
  model.value = {
    ...model.value,
    format: checked ? selectedFormat.value : null,
  };
}

function onQualityChange(value: number) {
  model.value = { ...model.value, quality: value };
}

function onMaxWidthChange(value: number | null) {
  model.value = { ...model.value, maxWidth: value };
}

function onMaxHeightChange(value: number | null) {
  model.value = { ...model.value, maxHeight: value };
}

function onStripMetadataChange(checked: boolean) {
  model.value = { ...model.value, stripMetadata: checked };
}
</script>

<template>
  <div class="settings">
    <NFormItem label="Формат">
      <div class="format-row">
        <NCheckbox :checked="changeFormat" @update:checked="onFormatToggle">Изменить формат</NCheckbox>
        <NSelect
          v-model:value="selectedFormat"
          :options="formatOptions"
          :disabled="!changeFormat"
          style="width: 200px"
        />
      </div>
    </NFormItem>

    <NFormItem :label="`Качество: ${model.quality}`">
      <NSlider :value="model.quality" :min="1" :max="100" :step="1" @update:value="onQualityChange" />
    </NFormItem>

    <div class="resize-row">
      <NFormItem label="Макс. ширина (px)">
        <NInputNumber
          :value="model.maxWidth"
          :min="1"
          :max="10000"
          clearable
          placeholder="Без ограничения"
          style="width: 100%"
          @update:value="onMaxWidthChange"
        />
      </NFormItem>
      <NFormItem label="Макс. высота (px)">
        <NInputNumber
          :value="model.maxHeight"
          :min="1"
          :max="10000"
          clearable
          placeholder="Без ограничения"
          style="width: 100%"
          @update:value="onMaxHeightChange"
        />
      </NFormItem>
    </div>

    <NFormItem>
      <NCheckbox :checked="model.stripMetadata" @update:checked="onStripMetadataChange">
        Удалить EXIF-метаданные
      </NCheckbox>
    </NFormItem>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.format-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.resize-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 600px) {
  .resize-row {
    grid-template-columns: 1fr;
  }
}
</style>
