#include "common-defines.h"
#include <libopencm3/stm32/rcc.h>
#include <libopencm3/stm32/gpio.h>
#include <libopencm3/stm32/memorymap.h>
#include <libopencm3/cm3/vector.h>

#include "core/uart.h"
#include "core/system.h"
#include "comms.h"
#include "bl-flash.h"
#include "core/simple-timer.h"

/**
 * USART_1_TX PA9, AF07
 * USART_1_RX PA10, AF07
 */
#define UART_PORT (GPIOA)
#define TX_PIN (GPIO9)
#define RX_PIN (GPIO10)

#define BOOTLOADER_SIZE (0x8000U)
#define MAIN_APP_START_ADDRESS (FLASH_BASE + BOOTLOADER_SIZE)

static void gpio_setup(void)
{
  rcc_periph_clock_enable(RCC_GPIOA);
  gpio_mode_setup(UART_PORT, GPIO_MODE_AF, GPIO_PUPD_NONE, TX_PIN | RX_PIN);
  gpio_set_af(UART_PORT, GPIO_AF7, TX_PIN | RX_PIN);
}

static void jump_to_main(void)
{
  vector_table_t *main_vector_table = (vector_table_t *)MAIN_APP_START_ADDRESS;
  main_vector_table->reset();
}

int main(void)
{
  system_setup();
  // gpio_setup();
  // uart_setup();
  // comms_setup();

  simple_timer_t timer;
  simple_timer_setup(&timer, 1000, false);

  while (true)
  {
    if (simple_timer_has_elapsed(&timer))
    {
      volatile int x = 0;
      x++;
    }
  }

  // TODO: Teardown

  jump_to_main();

  /* Never return*/
  return 0;
}