<script setup lang="ts">
import { computed, h } from 'vue';
import { NButton, NDataTable, NTag, type DataTableColumns } from 'naive-ui';
import { formatBytes, getFileDownloadUrl, getZipDownloadUrl, savingsPercent } from '../api/client';
import type { JobFileSummary } from '../types';

const props = defineProps<{
  jobId: string;
  files: JobFileSummary[];
}>();

const doneCount = computed(() => props.files.filter((f) => f.status === 'done').length);

const columns: DataTableColumns<JobFileSummary> = [
  { title: 'Файл', key: 'originalName', ellipsis: { tooltip: true } },
  {
    title: 'До',
    key: 'sizeBefore',
    width: 100,
    render: (row) => formatBytes(row.sizeBefore),
  },
  {
    title: 'После',
    key: 'sizeAfter',
    width: 100,
    render: (row) => (row.sizeAfter ? formatBytes(row.sizeAfter) : '—'),
  },
  {
    title: 'Экономия',
    key: 'savings',
    width: 100,
    render: (row) => savingsPercent(row.sizeBefore, row.sizeAfter),
  },
  {
    title: 'Статус',
    key: 'status',
    width: 120,
    render: (row) => {
      const typeMap = {
        pending: 'default',
        processing: 'warning',
        done: 'success',
        failed: 'error',
      } as const;
      const labelMap = {
        pending: 'Ожидание',
        processing: 'Обработка',
        done: 'Готово',
        failed: 'Ошибка',
      };
      return h(NTag, { size: 'small', type: typeMap[row.status] }, () => labelMap[row.status]);
    },
  },
  {
    title: '',
    key: 'actions',
    width: 120,
    render: (row) => {
      if (row.status !== 'done') return '—';
      return h(
        NButton,
        {
          size: 'small',
          tag: 'a',
          href: getFileDownloadUrl(props.jobId, row.id),
          download: true,
        },
        () => 'Скачать',
      );
    },
  },
];
</script>

<template>
  <div class="results">
    <div class="results-header">
      <h3>Результаты</h3>
      <NButton
        v-if="doneCount > 0"
        type="primary"
        tag="a"
        :href="getZipDownloadUrl(jobId)"
        download
      >
        Скачать всё (ZIP)
      </NButton>
    </div>
    <NDataTable :columns="columns" :data="files" :bordered="false" size="small" />
  </div>
</template>

<style scoped>
.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.results h3 {
  margin: 0;
}
</style>
