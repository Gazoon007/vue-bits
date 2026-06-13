<template>
  <TabbedLayout>
    <template #preview>
      <div class="demo-container h-[500px] overflow-hidden p-0">
        <FluidGlass
          :key="mode"
          :mode="mode"
          :lens-props="mode === 'lens' ? activeModeProps : {}"
          :bar-props="mode === 'bar' ? activeModeProps : {}"
          :cube-props="mode === 'cube' ? activeModeProps : {}"
        />
      </div>

      <Customize>
        <PreviewSelect title="Mode" v-model="mode" :options="modeOptions" @update:model-value="onModeChange" />

        <PreviewSlider title="Scale" v-model="scale" :min="0.05" :max="0.5" :step="0.05" />

        <PreviewSlider title="IOR" v-model="ior" :min="1" :max="2" :step="0.05" />

        <PreviewSlider title="Thickness" v-model="thickness" :min="1" :max="20" :step="1" />

        <PreviewSlider
          title="Chromatic Aberration"
          v-model="chromaticAberration"
          :min="0"
          :max="0.5"
          :step="0.01"
        />

        <PreviewSlider title="Anisotropy" v-model="anisotropy" :min="0" :max="0.1" :step="0.01" />

        <template v-if="mode === 'bar'">
          <PreviewSlider title="Transmission" v-model="transmission" :min="0" :max="1" :step="0.1" />
          <PreviewSlider title="Roughness" v-model="roughness" :min="0" :max="1" :step="0.1" />
        </template>
      </Customize>

      <PropTable :data="propData" />
      <Dependencies :dependency-list="['three']" />
    </template>

    <template #code>
      <CodeExample :code-object="fluidGlass" />
    </template>

    <template #cli>
      <CliInstallation :command="fluidGlass.cli" />
    </template>
  </TabbedLayout>
</template>

<script setup lang="ts">
import CliInstallation from '@/components/code/CliInstallation.vue';
import CodeExample from '@/components/code/CodeExample.vue';
import Dependencies from '@/components/code/Dependencies.vue';
import Customize from '@/components/common/Customize.vue';
import PreviewSelect from '@/components/common/PreviewSelect.vue';
import PreviewSlider from '@/components/common/PreviewSlider.vue';
import PropTable from '@/components/common/PropTable.vue';
import TabbedLayout from '@/components/common/TabbedLayout.vue';
import { fluidGlass } from '@/constants/code/Components/fluidGlassCode';
import FluidGlass from '@/content/Components/FluidGlass/FluidGlass.vue';
import { computed, ref } from 'vue';

type Mode = 'lens' | 'bar' | 'cube';

const mode = ref<Mode>('lens');
const scale = ref(0.25);
const ior = ref(1.15);
const thickness = ref(2);
const transmission = ref(1);
const roughness = ref(0);
const chromaticAberration = ref(0.05);
const anisotropy = ref(0.01);

const modeOptions = [
  { label: 'Lens', value: 'lens' },
  { label: 'Bar', value: 'bar' },
  { label: 'Cube', value: 'cube' }
];

const onModeChange = (next: string | number | undefined) => {
  if (next === 'bar') {
    scale.value = 0.15;
    transmission.value = 1;
    roughness.value = 0;
    thickness.value = 10;
    ior.value = 1.15;
  } else if (next === 'lens' || next === 'cube') {
    scale.value = 0.25;
    ior.value = 1.15;
    thickness.value = 5;
    chromaticAberration.value = 0.1;
    anisotropy.value = 0.01;
  }
};

const activeModeProps = computed(() => {
  const base = {
    scale: scale.value,
    ior: ior.value,
    thickness: thickness.value,
    chromaticAberration: chromaticAberration.value,
    anisotropy: anisotropy.value
  };
  if (mode.value === 'bar') {
    return {
      ...base,
      transmission: transmission.value,
      roughness: roughness.value,
      color: '#ffffff',
      attenuationColor: '#ffffff',
      attenuationDistance: 0.25,
      navItems: [
        { label: 'Home', link: '' },
        { label: 'About', link: '' },
        { label: 'Contact', link: '' }
      ]
    };
  }
  return base;
});

const propData = [
  {
    name: 'mode',
    type: "'lens' | 'bar' | 'cube'",
    default: "'lens'",
    description: 'Display mode of the fluid glass effect.'
  },
  {
    name: 'lensProps',
    type: 'object',
    default: '{}',
    description: 'Props for lens mode such as scale, ior, thickness, chromaticAberration and anisotropy.'
  },
  {
    name: 'barProps',
    type: 'object',
    default: '{}',
    description: 'Props for bar mode including navItems and transmission material options.'
  },
  {
    name: 'cubeProps',
    type: 'object',
    default: '{}',
    description: 'Props for cube mode using the same material controls as lens mode.'
  }
];
</script>
